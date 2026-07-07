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

## i18n Rule
All user-facing strings (labels, titles, placeholders, button text, alerts, error messages) **must** be
translated via `t()` keys. **Exception:** the app name "One Roof" only. No hardcoded English.
When adding new UI, add the keys to all 3 language files (en/es/pt) in `@/lib/i18n` first,
then import `useI18n` in the component and wrap strings: `{t('namespace.key')}` or 
`title={t('namespace.key', {param})}`.

## Coding standards

**Match the established pattern — don't invent a new one.** Before writing a new
`lib/` file or a data-fetching/auth flow, grep for how the existing files in the
same area already do it (`lib/auth.tsx`, `lib/googleCalendar.ts` are the
reference implementations for anything session/auth-related) and follow that,
even if a different approach would also technically work. Divergent one-off
patterns are exactly what caused the two bugs below — both were an agent
solving an already-solved problem a new way instead of matching what was
already there.

- **Reading the current user/session: always `supabase.auth.getSession()`,
  never `supabase.auth.getUser()`.** `getSession()` reads the cached local
  session (instant, no network). `getUser()` round-trips to the Auth server to
  revalidate the JWT — on any network hiccup it resolves with `user: null`
  instead of throwing, which silently masquerades as "not signed in" deep
  inside unrelated flows. (Real bug: `lib/appleCalendar.ts`'s `currentUser()`
  used `getUser()`, so a flaky connection made Apple Calendar connect fail
  with a generic "Couldn't connect" error — fixed by switching to
  `getSession()`, matching `auth.tsx` and `googleCalendar.ts`.) If a screen
  already has `useAuth()` in scope, prefer its `profile`/`session` over a
  fresh lookup at all.
- **Never define a component inside another component's render body.**
  `function Inner() {...}` (or a `const Inner = () =>`) written inside
  `function Outer() { ... return <Inner/> }` gets a *new function identity on
  every render of `Outer`* — React then unmounts + remounts `Inner` on every
  state change, which drops focus from any `TextInput` inside it and resets
  any local state. Hoist sub-components to module scope (outside and above the
  parent), passing data in as props. (Real bug: `BetterDeal.tsx`'s
  `OptionCard` was defined inside `BetterDeal`, so every keystroke into either
  price/amount field remounted both cards' inputs, dropping keyboard focus
  mid-type the moment the "better deal" winner calculation changed. Fixed by
  hoisting `OptionCard` above `BetterDeal`.) A plain function that *returns*
  JSX and is called directly (`{card('A', ...)}`, not `<Card/>`) is fine — it
  doesn't create a new component type, just inlines the tree.
- **Before shipping a fix for a reported bug, verify the actual root cause**
  against the DB (migrations, RLS, constraints via the Supabase MCP tools) and
  the client code path, not just the symptom. A generic error message (e.g.
  "Couldn't connect") can come from several unrelated causes — confirm which
  one before touching code.

## Don't
- Don't add ad/tracking SDKs (keeps ATT off + COPPA exposure low).
- Don't break the RLS tenancy model. Don't hardcode secrets (use EXPO_PUBLIC_* /
  EAS env). Don't claim device verification you didn't do.
- Don't hardcode user-facing strings — add them to i18n files and use `t()` in the component.
- Don't use `supabase.auth.getUser()` for session/current-user checks — use
  `supabase.auth.getSession()` (see Coding standards above).
- Don't define a component function inside another component's render body —
  hoist it to module scope (see Coding standards above).
