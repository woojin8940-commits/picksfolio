import { NativeModules } from 'react-native';
import { login as kakaoLogin } from '@react-native-seoul/kakao-login';

/**
 * 카카오톡 앱 연동 간편로그인 (native Kakao SDK).
 *
 * 이 앱은 웹앱을 WebView 로 감싼 껍데기라 로그인도 웹 흐름을 그대로 쓰는 게
 * 원칙이다. 카카오 로그인만은 예외다. 인앱 WebView 에서 카카오톡으로 넘어가면
 * 카카오톡은 인가 코드를 "기본 브라우저"로 돌려보내기 때문에 — 우리 WebView 가
 * 아니라 사파리/크롬이 열린다 — 앱 안에서는 그 왕복이 끝까지 이어지지 않는다.
 * 그래서 앱은 네이티브 SDK 로 카카오톡과 직접(app-to-app) 주고받고, 받은 ID
 * 토큰만 WebView 로 넘겨 준다. 세션은 웹앱이 `signInWithIdToken` 으로 만들기
 * 때문에 만들어지는 계정·identity 는 웹에서 로그인한 것과 완전히 같다.
 *
 * 네이티브 모듈은 Development/EAS 빌드에만 들어 있다(Expo Go 에는 없다).
 * 그래서 호출 전에 `isKakaoNativeLoginAvailable()` 로 확인하고, 없으면 웹앱이
 * 기존 웹 로그인 경로를 쓰도록 아예 알리지 않는다.
 */

/** Native SDK 가 이 빌드에 포함되어 있는지 (Expo Go / 키 미설정 빌드에서는 false). */
export function isKakaoNativeLoginAvailable(): boolean {
  return NativeModules.RNKakaoLogins != null;
}

export type KakaoNativeTokens = {
  /** OIDC ID 토큰. Supabase 로그인에 쓰는 값. */
  idToken: string;
  /** 카카오 API 액세스 토큰 (프로필·전화번호 조회에 쓰인다). */
  accessToken: string;
};

/**
 * 카카오톡이 깔려 있으면 앱으로 넘겨 로그인하고, 없으면 SDK 가 알아서
 * 카카오계정 로그인으로 넘어간다. `nonce` 는 넘기지 않는다 — 토큰이 SDK 에서
 * WebView 로만 건네지고 밖으로 나가지 않으므로 재생 공격 여지가 없고, nonce
 * 클레임이 붙으면 서버 검증 쪽에서 같은 값을 다시 맞춰 줘야 한다.
 */
export async function signInWithKakaoTalk(): Promise<KakaoNativeTokens> {
  const token = await kakaoLogin();
  const idToken = token?.idToken || '';
  if (!idToken) {
    // 콘솔에서 OpenID Connect 를 켜지 않으면 ID 토큰 없이 액세스 토큰만 온다.
    throw new Error(
      'ID 토큰을 받지 못했습니다. 카카오 개발자 콘솔에서 OpenID Connect 를 활성화해 주세요.'
    );
  }
  return { idToken, accessToken: token?.accessToken || '' };
}
