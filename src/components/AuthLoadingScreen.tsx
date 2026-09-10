import React, { useEffect } from 'react';

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
 * 색은 홈·로그인 화면과 같은 종이색(#F4F5FA)이다. 예전에는 검정이었는데, 홈이
 * 종이색으로 바뀐 뒤로는 로그인 버튼을 누른 순간 화면이 한 번 검게 내려앉았다가
 * 밝은 대시보드(#f8fafc)로 돌아왔다 — 밝은 화면 사이에 검정 한 장이 끼어 있던
 * 셈이다. 이제 홈 → 로그인 → 이 화면 → 대시보드가 모두 같은 밝기다.
 *
 * 같은 그림을 `index.html` 이 정적 마크업으로도 한 벌 갖고 있다. 위 (1) 구간은
 * 리액트가 뜨기 전이라 이 컴포넌트가 그려 줄 수 없어서, 그때는 index.html 의
 * 것이 자리를 지킨다. 둘의 색·크기·문구를 바꿀 때는 반드시 같이 바꿔야 한다 —
 * 어긋나면 리액트가 뜨는 순간 화면이 한 번 튄다.
 *
 * 화면을 `fixed inset-0` 으로 두는 이유는 그대로다 — 데스크톱의 페이지 확대
 * (html { zoom: 0.75 })와 높이 계산을 두고 다투지 않는다. 다만 body 색은 여전히
 * 검정이므로, 그것만으로는 iOS 의 overscroll 되돌림 구간과 확대가 남기는 바깥
 * 여백에서 검정이 비친다. 그래서 이 화면이 떠 있는 동안에만 body 에
 * `auth-paper` 를 걸고 나갈 때 뗀다(index.css). 리액트가 뜨기 전 구간에서는
 * index.html 이 같은 색을 인라인으로 먼저 깔아 두므로 이어받기만 하면 된다.
 *
 * 서서히 나타나는 효과(animate-in)는 일부러 넣지 않는다. index.html 이 이미
 * 같은 화면을 그려 둔 뒤 이 컴포넌트로 넘어오는 것이라, 여기서 다시 페이드하면
 * 화면이 한 번 어두워졌다 밝아진다.
 */
const AuthLoadingScreen: React.FC<{ message?: string }> = ({ message = '로그인 중입니다' }) => {
  useEffect(() => {
    document.body.classList.add('auth-paper');
    return () => {
      document.body.classList.remove('auth-paper');
      // index.html 이 리액트보다 먼저 깔아 둔 인라인 색도 여기서 함께 치운다.
      // 남겨 두면 개인페이지·라이브처럼 다크로 남는 화면의 바깥 여백이 밝게 뜬다.
      document.body.style.removeProperty('background-color');
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#F4F5FA]"
      role="status"
      aria-live="polite"
    >
      {/* 홈과 같은 배경 — 옅은 점 격자에 파란 얼룩 하나. 움직이지 않는 레이어다. */}
      <div aria-hidden className="absolute inset-0 home-dotgrid opacity-70" />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: 'radial-gradient(circle at 50% 38%, rgba(37,99,235,0.16), transparent 62%)' }}
      />

      <div className="relative flex flex-col items-center">
        <div className="flex items-center gap-1.5">
          <span className="text-2xl font-black tracking-tighter text-[#0B0F1A] font-display">PICKS</span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB] translate-y-1.5" />
        </div>
        <div
          className="mt-6 w-10 h-10 rounded-full animate-spin"
          style={{ border: '3px solid rgba(37,99,235,0.18)', borderTopColor: '#2563EB' }}
        />
        <p className="mt-4 text-[#4A5273] font-bold text-sm">{message}</p>
      </div>
    </div>
  );
};

export default AuthLoadingScreen;
