// Expo config plugin: declare KakaoTalk in the Android manifest's <queries>.
//
// Android 11 (API 30) hides other installed apps from an app that does not
// declare what it wants to look up. The Kakao SDK decides between 간편로그인
// (hand off to the KakaoTalk app) and 카카오계정 로그인 (type your ID/password
// in a browser tab) by calling `UserApiClient.isKakaoTalkLoginAvailable()`,
// which resolves the `kakaokompassauth://` intent against installed packages.
// Without the declaration below that lookup always comes back empty, so a
// device with KakaoTalk installed still gets the ID/password screen — silently,
// because the fallback is a supported path and nothing errors out.
//
// `@react-native-seoul/kakao-login`'s own config plugin adds the auth handler
// activity, the `kakao{APP_KEY}://oauth` scheme and the iOS Info.plist entries,
// but not this <queries> block, so we add it here. iOS has the equivalent
// declaration already: `LSApplicationQueriesSchemes` in app.json lists
// `kakaokompassauth` / `kakaotalk` / `kakaolink`.
//
// Idempotent: the package is only appended when it is not already declared, so
// re-running prebuild (or a future SDK that starts shipping its own <queries>)
// cannot produce a duplicate entry.

const { withAndroidManifest } = require('@expo/config-plugins');

const KAKAO_TALK_PACKAGE = 'com.kakao.talk';

module.exports = function withKakaoTalkQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    if (!Array.isArray(manifest.queries)) manifest.queries = [];
    if (manifest.queries.length === 0) manifest.queries.push({});

    const query = manifest.queries[0];
    if (!Array.isArray(query.package)) query.package = [];

    const already = query.package.some(
      (entry) => entry?.$?.['android:name'] === KAKAO_TALK_PACKAGE
    );
    if (!already) {
      query.package.push({ $: { 'android:name': KAKAO_TALK_PACKAGE } });
    }

    return cfg;
  });
};
