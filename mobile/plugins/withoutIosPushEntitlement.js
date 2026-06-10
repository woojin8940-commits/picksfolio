// Expo config plugin: drop the iOS Push Notifications entitlement at prebuild.
//
// `expo-notifications` makes Expo's prebuild write the `aps-environment` push
// entitlement into the generated `PICKSFolio.entitlements` file. For the App
// Store archive to validate, that entitlement must also be present on the App
// Store provisioning profile — which only happens once the Push Notifications
// capability is enabled on the Apple App ID (`com.picksfolio.app`) and the
// profile is regenerated. That is an Apple Developer / EAS credentials action,
// not something the repo can do.
//
// Until that one-time provisioning is done, the entitlement is present in the
// build but missing from the profile, so `xcodebuild archive` fails with:
//
//   Provisioning profile "…AppStore…" does not support the Push Notifications
//   capability. / Entitlements file defines the value "aps-environment" which
//   is not registered for profile.
//
// This plugin removes `aps-environment` from the generated entitlements so the
// archive is self-consistent and the app keeps shipping. The push code
// (`src/services/push.ts`) degrades gracefully on iOS — `getExpoPushTokenAsync`
// simply returns null without the entitlement — and Android push is unaffected.
//
// To fully enable iOS remote push later: enable the Push Notifications
// capability for `com.picksfolio.app` in the Apple Developer portal, regenerate
// the App Store provisioning profile (e.g. `eas credentials`), then delete this
// plugin from `app.json` so the entitlement is emitted again.

const { withEntitlementsPlist } = require('@expo/config-plugins');

module.exports = function withoutIosPushEntitlement(config) {
  return withEntitlementsPlist(config, (cfg) => {
    if (cfg.modResults && 'aps-environment' in cfg.modResults) {
      delete cfg.modResults['aps-environment'];
    }
    return cfg;
  });
};
