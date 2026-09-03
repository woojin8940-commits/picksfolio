// Expo config plugin: declare KakaoTalk in the Android manifest's <queries>.
//
// Android 11 (API 30) hides other installed apps from an app that does not
// declare what it wants to resolve. The WebView intercepts Kakao's app scheme
// or intent URL and hands it to React Native Linking; this package query lets
// Android resolve that hand-off to the installed KakaoTalk app. iOS has the
// equivalent schemes in app.json's LSApplicationQueriesSchemes.
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
