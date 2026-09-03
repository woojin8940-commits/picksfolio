# PICKS Folio — Mobile App

The native companion app for the PICKS Folio creator platform, built with
[Expo](https://expo.dev) (React Native) and file-based routing via `expo-router`.

The app is a thin native shell around the production mobile web app
(`https://picks-folio.com`): it renders the website inside a full-screen
WebView so every feature — Kakao/이메일 로그인, 결제, 라이브 커머스, 정산,
알림 등 모든 연동 시스템 — behaves exactly like the mobile web, with no
duplicated native logic to drift out of sync. Native-only concerns (KakaoTalk
hand-off, 결제 앱 전환, 권한, 뒤로가기, 새로고침) are handled by the shell.

## Stack

- Expo SDK 52 / React Native 0.76
- `expo-router` (typed, file-based routing)
- `react-native-webview`
- `amazon-ivs-react-native-broadcast` (native live broadcast)
- `@react-native-seoul/kakao-login` (카카오톡 앱 연동 로그인)
- TypeScript (strict)

## Native live broadcast (Amazon IVS)

Going live no longer runs inside the WebView. Tapping **방송 시작** in the web
live console while inside the app hands off to a native broadcast screen
(`app/broadcast.tsx`) that pushes the phone camera straight to the seller's
Amazon IVS channel over RTMPS using the hardware encoder
(`amazon-ivs-react-native-broadcast`). The screen supports:

- 후면/전면 카메라 전환, 마이크 on/off, 방송 시작/종료
- 세로 1080p · 30fps 인코딩 프로파일 (자동 비트레이트)
- 실시간 상태 표시 (대기 중 / 연결 중 / 방송 중 / 오류)
- IVS 인제스트 서버·스트림 키를 직접 입력하거나, `/api/stream-key/:username`
  에서 저장된 채널 정보를 불러오기

While live, the screen mirrors the channel's live state to `/api/live/:username`
so web viewers discover and play the broadcast exactly as before. The native
broadcast module requires a dev/EAS build — it does not run in Expo Go.

The web app hands off via a small bridge the shell injects
(`window.PicksFolioNative.openBroadcast(...)`); the native screen can also be
reached with the `picksfolio://broadcast?username=…` deep link.

## 카카오톡 앱 연동 로그인 (간편로그인)

로그인은 웹앱 화면을 그대로 쓰지만, 카카오 로그인만 네이티브 SDK
(`@react-native-seoul/kakao-login`)를 거친다. 인앱 WebView 에서 카카오톡으로
넘어가면 카카오톡은 인가 코드를 **기본 브라우저**로 돌려보내기 때문에 — 우리
WebView 가 아니라 사파리·크롬이 열린다 — 웹 흐름만으로는 앱 안에서 왕복이
끝나지 않고, 결국 카카오계정 아이디·비밀번호를 직접 입력하는 화면으로 떨어졌다.

셸은 `window.PicksFolioNative.kakaoLogin()` 을 주입한다. 웹앱이 이걸 부르면
셸이 카카오톡과 앱-to-앱으로 로그인하고 ID 토큰을 돌려주고, 세션은 웹앱이
`signInWithIdToken` 으로 만든다. 그래서 만들어지는 계정·연동 데이터는 웹에서
로그인한 것과 완전히 같다.

빌드하기 전에 네이티브 앱 키를 넣어야 한다(EAS 시크릿, 로컬은 `mobile/.env`):

```
EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY=<카카오 개발자 콘솔 > 앱 키 > 네이티브 앱 키>
```

이 값이 있으면 `app.config.js` 가 카카오 플러그인을 붙여
`kakao{네이티브앱키}://oauth` 스킴과 iOS `KAKAO_APP_KEY`,
Android `kakao_app_key` 문자열 자원을 넣고, `plugins/withKakaoTalkQueries.js` 가
Android 11+ 패키지 조회(`<queries>`)를 선언한다. 이 `<queries>` 선언이 없으면
카카오톡이 깔려 있어도 SDK 가 못 찾아서 조용히 계정 로그인으로 넘어간다.

값이 없으면 플러그인은 빠지고, 앱은 예전처럼 웹 로그인 흐름을 쓴다(빌드는 된다).

콘솔 쪽 준비물:

- **플랫폼 등록** — iOS 번들 ID `com.picksfolio.app`, Android 패키지
  `com.picksfolio.app` + 릴리스/디버그 키 해시
- **카카오 로그인 활성화**, **OpenID Connect 활성화** (ID 토큰이 여기서 나온다)
- **동의 항목** — 닉네임·이메일·이름·전화번호
- Supabase 카카오 provider 의 Client ID 에 REST API 키와 **네이티브 앱 키를
  콤마로 함께** 넣는다. 네이티브 SDK 가 준 ID 토큰의 `aud` 는 네이티브 앱 키라서,
  등록해 두지 않으면 Supabase 가 토큰을 거부한다.

네이티브 모듈이므로 Development/EAS 빌드가 필요하다 — Expo Go 에서는 동작하지
않고, 그 경우 셸이 아예 알리지 않아서 웹 로그인 흐름이 그대로 쓰인다.

## Getting started

```bash
cd mobile
npm install
npm start        # then press i for iOS simulator, a for Android
```

## Configuration

Which web origin to load. It defaults to the production site; override it per
build via a public Expo env var (create a gitignored `mobile/.env` for local
runs):

```
EXPO_PUBLIC_WEB_URL=https://picks-folio.com
EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY=<카카오 네이티브 앱 키>
```

Point it at a deploy preview or `http://<your-lan-ip>:5173` to test against a
different build of the web app.

## iOS builds & TestFlight

CI builds are produced by EAS and shipped to TestFlight via the
`.github/workflows/eas-ios-testflight.yml` workflow (manual dispatch, or by
pushing a `mobile-v*` tag). Build and submit profiles (App Store Connect app ID
and Apple team ID) live in `eas.json`. Set the `EXPO_TOKEN` repository secret to
authorise CI builds.
