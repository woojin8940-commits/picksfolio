// Dynamic Expo config: layer the Kakao 간편로그인 (KakaoTalk app hand-off) native
// setup on top of the static `app.json`.
//
// Expo reads `app.json` first and hands it to this function as `config`, so
// everything stays declared in `app.json` and only the parts that depend on a
// secret-ish build-time value live here. The Kakao native app key has to reach
// the native side as an Android string resource + iOS Info.plist entry, which
// is exactly what the library's config plugin does with `kakaoAppKey` — but the
// key must not be committed, so it comes from the environment.
//
// Set it before building (EAS secret / `mobile/.env` for local dev builds):
//
//   EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY=<카카오 개발자 콘솔 > 앱 키 > 네이티브 앱 키>
//
// When the variable is missing the Kakao plugins are simply left out: the app
// still builds and Kakao login still works, but it falls back to the web login
// flow inside the WebView instead of handing off to the KakaoTalk app. That way
// a build without the key configured degrades instead of failing.
//
// Requires a Development/EAS build — the Kakao native module does not exist in
// Expo Go.

const KAKAO_NATIVE_APP_KEY = (
  process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY ?? ''
).trim();

module.exports = ({ config }) => {
  if (!KAKAO_NATIVE_APP_KEY) {
    console.warn(
      '[app.config] EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY 가 없어 카카오톡 앱 연동 로그인을 건너뜁니다. ' +
        '앱 안에서는 웹 로그인 방식이 그대로 쓰입니다.'
    );
    return config;
  }

  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      // 네이티브 카카오 SDK 연결: AuthCodeHandlerActivity + kakao{APP_KEY}://oauth
      // 스킴, Android strings.xml 의 kakao_app_key, iOS Info.plist 의
      // KAKAO_APP_KEY · CFBundleURLTypes, AppDelegate 의 openURL 처리까지 넣어 준다.
      ['@react-native-seoul/kakao-login', { kakaoAppKey: KAKAO_NATIVE_APP_KEY }],
      // 위 플러그인이 넣지 않는 Android 11+ 패키지 조회 선언. 이게 없으면 카카오톡이
      // 깔려 있어도 SDK 가 못 찾아서 계정(아이디/비밀번호) 로그인으로 넘어간다.
      './plugins/withKakaoTalkQueries',
    ],
  };
};
