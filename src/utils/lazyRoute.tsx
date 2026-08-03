import React, { lazy, Suspense } from 'react';
import ErrorBoundary from '../components/ErrorBoundary';
import { attemptChunkReload, isChunkLoadError } from './chunkReload';

/**
 * 화면 단위 코드 스플리팅에서 쓰는 `React.lazy` 래퍼.
 *
 * 여기서 반드시 지켜야 하는 규칙이 하나 있다: **끝나지 않는 Promise 를 돌려주지
 * 않는다.** 예전 구현은 자동 새로고침을 시작한 뒤 `new Promise(() => {})` 를
 * 반환해서 "새로고침이 화면을 가져갈 테니 그때까지 로딩 표시를 유지한다"는 뜻이었다.
 * 그런데 새로고침이 실제로 일어나지 않으면(인앱 웹뷰에서 reload 가 무시되거나,
 * sessionStorage 가 막혀 회복을 건너뛰는 경우) 그 Suspense 는 영원히 풀리지 않는다.
 * 화면에는 "로딩 중..." 만 남고, 오류 경계도 잡을 오류가 없어 아무 안내도 못 한다.
 * 디엠 자동화 메뉴가 계속 로딩 중이던 원인이 이것이다.
 *
 * 그래서 지금은 (1) 한 번 재시도하고, (2) 자동 새로고침을 시도하되, (3) 어느 쪽도
 * 성공하지 못하면 **오류를 던진다**. 던진 오류는 `LazyRoute` 의 오류 경계가 받아
 * "다시 시도" 버튼이 있는 화면을 보여준다.
 */
export function lazyWithRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await factory();
    } catch (first) {
      // 짧은 네트워크 끊김이라면 한 번 더 시도하는 것으로 끝난다.
      await new Promise((r) => setTimeout(r, 400));
      try {
        return await factory();
      } catch (second) {
        // 여기까지 왔으면 대개 배포가 갱신되어 청크가 사라진 경우다. 새 매니페스트를
        // 받아오는 새로고침을 (쿨다운 안에서) 한 번 시도한다. 새로고침이 실제로
        // 시작됐더라도 오류는 그대로 던진다 — 화면을 잡아 두지 않기 위해서다.
        if (isChunkLoadError(second)) attemptChunkReload();
        throw second;
      }
    }
  });
}

export const RouteFallback = () => (
  <div className="flex items-center justify-center min-h-[40vh]">
    <div className="text-center animate-in fade-in duration-300">
      <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
      <p className="text-slate-400 font-semibold text-xs">로딩 중...</p>
    </div>
  </div>
);

/**
 * 지연 로딩 화면 한 개를 감싸는 껍데기: 로딩 표시 + 오류 경계.
 *
 * Suspense 만 두면 청크를 못 받은 화면이 로딩 표시에서 멈춘 것처럼 보인다. 오류
 * 경계를 항상 함께 붙여서, 못 불러온 화면은 "못 불러왔다"고 말하게 한다.
 */
export const LazyRoute: React.FC<{ children: React.ReactNode; fallback?: React.ReactNode }> = ({
  children,
  fallback,
}) => (
  <ErrorBoundary>
    <Suspense fallback={fallback ?? <RouteFallback />}>{children}</Suspense>
  </ErrorBoundary>
);
