# PICKS Folio — Mobile App

The native companion app for the PICKS Folio creator platform, built with
[Expo](https://expo.dev) (React Native) and file-based routing via `expo-router`.

It gives creators an on-the-go view of their link-in-bio portfolio, incoming
brand collaboration campaigns, and earnings — mirroring the PICKS Folio web
experience.

## Stack

- Expo SDK 52 / React Native 0.76
- `expo-router` (typed, file-based routing)
- TypeScript (strict)
- Supabase JS client for data (configured via env)

## Getting started

```bash
cd mobile
npm install
npm start        # then press i for iOS simulator, a for Android
```

## Configuration

Supabase connection values are read from public Expo env vars. Create a
`mobile/.env` (gitignored) when wiring the app to a live backend:

```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Until these are set the app renders bundled sample data so the UI is always
demonstrable.

## iOS builds & TestFlight

CI builds are produced by EAS and shipped to TestFlight via the
`.github/workflows/eas-ios-testflight.yml` workflow (manual dispatch, or by
pushing a `mobile-v*` tag). Build profiles live in `eas.json`.

Before the first submission, replace the `REPLACE_WITH_*` placeholders in the
`submit` section of `eas.json` with your Apple ID, App Store Connect app ID, and
Apple team ID, and set the `EXPO_TOKEN` repository secret.
