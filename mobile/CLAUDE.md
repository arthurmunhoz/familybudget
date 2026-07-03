@AGENTS.md

# One Roof — native iOS app (Expo) — guide for developer agents

This is the React Native / Expo rewrite of the One Roof PWA (which lives in the
parent `family-budget/` repo). It reuses the same **Supabase** backend (same
project, same tables, same RLS). Goal: PWA parity on iOS + App Store readiness.
Architecture, systems, remaining setup, and the improvement backlog are in
`DOCUMENTATION.md` (the official app doc) — read it.

## Stack
- **Expo SDK 56 + expo-router** (file routes in `src/app/`), TypeScript, React 19.
- **Supabase** via `@/lib/supabase` (AsyncStorage session + url-polyfill). RLS is
  the security boundary — NEVER filter `household_id` client-side for security;
  column defaults stamp `household_id`/`created_by`/`sender_email`/etc. on insert.
- No NativeWind/Tailwind — styling is the theme + `StyleSheet`/inline.

## Conventions (reuse these — don't reinvent)
- **UI primitives** `@/components/ui`: `Screen`, `AppHeader`, `Card`, `Btn`,
  `Field`, `Txt({variant})`, `EmptyState`, `Loader`. Build every screen from these.
- **Theme** `@/theme/theme`: `useTheme()` → `{ dark, c }`; tokens `c` =
  bg/card/cardActive/surface/surface2/text/textMuted/textFaint/accent/accentSoft/
  income/expense/border (Warm Hearth, light+dark, follows system). Also `sp`,
  `radius`, `fonts` (Fraunces display + Hanken Grotesk UI, loaded in `_layout`).
- **Auth** `@/lib/auth`: `useAuth()` → `{ session, profile, profiles, loading,
  signInWithApple, signInWithGoogle, devSignIn, signOut }`. `profiles` = household
  members.
- **i18n** `@/hooks/useI18n`: `useI18n()` → `{ t, lang, setLang }`. Dicts in
  `@/lib/i18n` (en/es/pt) are the PWA dicts copied verbatim — add keys to all 3.
- **Pure logic copied from the PWA** lives in `@/lib/` (types, format, calendar,
  categories, petCare, stores, signedUrls, pings) — keep them in sync with the PWA
  or, post-cutover, treat these as the source of truth.
- Icons: `lucide-react-native`. Images: `expo-image` + `@/lib/signedUrls`. Dates:
  `@react-native-community/datetimepicker`. Camera/photos: `expo-image-picker` +
  `expo-image-manipulator`. Files: `expo-document-picker` + `expo-file-system`
  (SDK 56 `new File(uri).arrayBuffer()`). Face ID: `expo-local-authentication`.

## Module layout
`src/app/<route>.tsx` is the screen entry (replaces the old placeholders);
implementation lives in `src/apps/<id>/`. Nested routes use folders
(`src/app/budget/[budgetId]/[monthId].tsx`, `src/app/pets/[petId].tsx`).

## AI / server endpoints
Native calls the deployed Vercel API via `process.env.EXPO_PUBLIC_API_BASE`
(`https://one-roof-app.vercel.app`) with `Authorization: Bearer <session token>`:
`/api/scan-receipt` (Budget) and `/api/suggest-ping` (Nudges). Push fan-out and
Google Calendar sync still need server work (see the TODO doc).

## Verifying changes (no simulator in this harness)
There is no browser/simulator in the agent harness. The gate is:
```
cd mobile && npx tsc --noEmit            # types
cd mobile && npx expo export --platform ios --output-dir /tmp/x   # Metro bundle resolves all imports
```
Both must pass before committing. Real on-device behavior (auth, camera, Face ID,
push, layout) must be checked by a human on a simulator/device — say so, don't
claim it's verified.

## Don't
- Don't add ad/tracking SDKs (keeps ATT off + COPPA exposure low).
- Don't break the RLS tenancy model. Don't hardcode secrets (use EXPO_PUBLIC_* /
  EAS env). Don't claim device verification you didn't do.
