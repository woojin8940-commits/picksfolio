import React from 'react';

/**
 * 로그인이 끝나기를 기다리는 동안 보여 주는 화면. 하나뿐이다.
 *
 * 카카오 로그인 한 번에 화면이 네 번 바뀌던 문제가 여기서 시작됐다. 로그인 뒤
 * 대시보드까지 가는 길에는 서로 다른 자리에서 기다리는 구간이 이어져 있다 —
 * (1) 인가 코드를 세션으로 바꾸는 동안(앱이 아직 그려지지도 않는다),
 * (2) 프로필을 확인하는 동안, (3) 대시보드 화면 코드를 받아오는 동안. 각 자리가
 * 자기 로딩 표시를 따로 갖고 있었고 배경색도 제각각이었다 — 검정(#050507) →
 * 흰색(#f8fafc) → 배경 없음(다시 검정) → 밝은 대시보드. 한 번의 로그인인데
 * 화면이 검정·흰색으로 번갈아 깜빡였다.
 *
 * 그래서 기다리는 화면을 이 하나로 합쳤다. 위 세 구간이 모두 이걸 그리면 색도
 * 글자도 스피너 위치도 바뀌지 않아서, 로그인하는 사람 눈에는 로딩 화면이
 * 한 장만 떠 있다가 대시보드로 바뀐다.
 *
 * 같은 그림을 `index.html` 이 정적 마크업으로도 한 벌 갖고 있다. 위 (1) 구간은
 * 리액트가 뜨기 전이라 이 컴포넌트가 그려 줄 수 없어서, 그때는 index.html 의
 * 것이 자리를 지킨다. 둘의 색·크기·문구를 바꿀 때는 반드시 같이 바꿔야 한다 —
 * 어긋나면 리액트가 뜨는 순간 화면이 한 번 튄다.
 *
 * 배경이 body 와 같은 색(#050507)이라 화면을 다 덮지 못해도 색이 어긋나 보이지
 * 않는다. 그래서 min-height 계산 대신 `fixed inset-0` 으로 둔다 — 데스크톱의
 * 페이지 확대(html { zoom: 0.75 })와 높이 계산을 두고 다투지 않는다.
 *
 * 서서히 나타나는 효과(animate-in)는 일부러 넣지 않는다. index.html 이 이미
 * 같은 화면을 그려 둔 뒤 이 컴포넌트로 넘어오는 것이라, 여기서 다시 페이드하면
 * 화면이 한 번 어두워졌다 밝아진다.
 */
const AuthLoadingScreen: React.FC<{ message?: string }> = ({ message = '로그인 중입니다' }) => (
  <div
    className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-midnight"
    role="status"
    aria-live="polite"
  >
    <div className="w-10 h-10 border-3 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
    <p className="mt-4 text-slate-300 font-bold text-sm">{message}</p>
  </div>
);

export default AuthLoadingScreen;
