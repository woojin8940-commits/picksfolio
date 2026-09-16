# PICKS Folio — Mobile App

The native companion app for the PICKS Folio creator platform, built with
[Expo](https://expo.dev) (React Native) and file-based routing via `expo-router`.

The app is a thin native shell around the production mobile web app
(`https://picks-folio.com`): it renders the website inside a full-screen
WebView so every feature — Kakao/이메일 로그인, 결제, 캠페인, 정산, 알림 등
모든 연동 시스템 — behaves exactly like the mobile web, with no
duplicated native logic to drift out of sync. Native-only concerns (KakaoTalk
hand-off, 결제 앱 전환, 권한, 뒤로가기, 새로고침) are handled by the shell.

## Stack

- Expo SDK 52 / React Native 0.76
- `expo-router` (typed, file-based routing)
- `react-native-webview`
- `expo-notifications` (native push for new messages)
- TypeScript (strict)

## 카카오톡 앱 연동 로그인 (간편로그인)

로그인은 웹앱의 카카오 JS SDK/REST OAuth 흐름을 그대로 사용한다. WebView가
`kakaokompassauth://`, `kakaotalk://`, Android `intent://`, KakaoTalk 유니버설
링크를 감지하면 해당 요청만 `Linking.openURL()`로 OS에 넘겨 카카오톡 앱을 연다.
인가 코드 교환과 Supabase 세션 생성은 기존 웹 콜백이 계속 담당한다.

따라서 네이티브 카카오 SDK와 네이티브 앱 키는 필요하지 않다. Android 11+에서
카카오톡 앱을 찾을 수 있도록 `plugins/withKakaoTalkQueries.js`만 적용하며, iOS는
`app.json`의 `LSApplicationQueriesSchemes` 선언을 사용한다.

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
```

Point it at a deploy preview or `http://<your-lan-ip>:5173` to test against a
different build of the web app.

## iOS builds & TestFlight

CI builds are produced by EAS and shipped to TestFlight via the
`.github/workflows/eas-ios-testflight.yml` workflow (manual dispatch, or by
pushing a `mobile-v*` tag). Build and submit profiles (App Store Connect app ID
and Apple team ID) live in `eas.json`. Set the `EXPO_TOKEN` repository secret to
authorise CI builds.
