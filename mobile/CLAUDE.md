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
- **Private budgets (migration 058)**: a budget is `visibility='household'` by
  default; a Plus member can make one `'private'` (owner = `budgets.owner_email`,
  share list = `budget_members`). **months and entries reach the household
  THROUGH budgets** — hiding the budgets row alone leaves every period and entry
  readable, so all three policies go through `public.can_see_budget()`. A SELECT
  policy on budgets must test the row's own columns and must NOT call a definer
  function that re-queries budgets: that runs on its own snapshot, can't see the
  row being inserted, and breaks `INSERT ... RETURNING` — which PostgREST always
  emits (this bit us; see `is_budget_member`). Plus is gated by a TRIGGER on the
  transition INTO private, never a blanket check: a lapsed plan must never
  un-private a budget or lock its owner out. **Anything using the SERVICE ROLE
  bypasses all of this** and must filter visibility by hand (see the `budget`
  action in `api/widget.ts`).
- No NativeWind/Tailwind — styling is the theme + `StyleSheet`/inline.

## Conventions (reuse these — don't reinvent)
- **UI primitives** `@/components/ui`: `Screen`, `AppHeader`, `Card`, `Btn`,
  `Field`, `Txt({variant})`, `EmptyState`, `Loader`. Build every screen from these.
  Also `@/components/Toast` (self-dismissing confirmation, feed it a NEW object
  each time) and `@/components/DraggableList` (long-press-to-drag sortable —
  device-verified working). Reorder needs `react-native-draggable-flatlist`? No:
  it uses `useAnimatedGestureHandler`, REMOVED in reanimated 4 (we're on 4.3.1) —
  DraggableList is a small custom sortable on the modern `Gesture.Pan` +
  reanimated-4 APIs instead. Gestures inside a RN `<Modal>` need the modal's
  content wrapped in `<GestureHandlerRootView>` (the app-root one doesn't reach
  a modal's separate native hierarchy) — see `NudgeSettings.tsx`.
- **Theme** `@/theme/theme`: `useTheme()` → `{ dark, c }`; tokens `c` =
  bg/card/cardActive/surface/surface2/text/textMuted/textFaint/accent/accentSoft/
  income/expense/border (Warm Hearth, light+dark, follows system). Also `sp`,
  `radius`, `fonts` (Fraunces display + Hanken Grotesk UI, loaded in `_layout`).
  - **Glass skin (`theme/glass.tsx`, `GLASS` flag)** re-skins the app: a colour
    wash painted at the root, translucent cards, rounded Nunito titles. Set
    `GLASS = false` to get Warm Hearth back exactly.
  - **`card` vs `sheet` — the rule that keeps biting:** `card` is TRANSLUCENT so
    the wash reads through it on screens. Anything floating over something other
    than the wash — a `<Modal>` sheet (dim backdrop) or a panel on the
    Whereabouts map — MUST use `c.sheet` (opaque) or its content visibly mixes
    with the background. Rule of thumb: inside a `<Modal>`, use `c.sheet`.
    `sheet === card` outside the glass skin, so it's a no-op for Warm Hearth.
  - Under GLASS, `c.bg` is TRANSPARENT (that's how the wash shows). Never use it
    as a foreground/inverse colour — the toast's label did and vanished.
- **Auth** `@/lib/auth`: `useAuth()` → `{ session, profile, profiles, loading,
  signInWithApple, signInWithGoogle, devSignIn, signOut }`. `profiles` = household
  members.
- **i18n** `@/hooks/useI18n`: `useI18n()` → `{ t, lang, setLang }`. Dicts in
  `@/lib/i18n` (en/es/pt) are the PWA dicts copied verbatim — add keys to all 3.
- **Pure logic copied from the PWA** lives in `@/lib/` (types, format, calendar,
  categories, petCare, stores, signedUrls, pings) — keep them in sync with the PWA
  or, post-cutover, treat these as the source of truth.
- **Home-Screen widgets** `@/lib/widget.ts` + `targets/widgets/`: the widget
  extension can't reach the app's JS/Supabase session, so app data crosses via
  the shared App Group (`ExtensionStorage`) — mirror new data the same way
  (JSON string via `.set(key, ...)`, scoped `ExtensionStorage.reloadWidget(kind)`,
  matching key names in the Swift loader). `useSyncNudgeWidget` (mounted in
  `_layout.tsx`) is the reference for "sync on login, not on screen visit."
  See `DOCUMENTATION.md` §3 for the full picture (confirmation-timeline
  mechanism, silent ack push).
  - **A widget CAN do its own networking** — no Supabase session needed. Three
    live examples: Nudges POSTs to `/api/widget-nudge`, Today pulls weather
    straight from Open-Meteo (public, keyless) plus its agenda from
    `/api/widget?action=today`, and PetCare reads `?action=petcare` / marks a
    task via `?action=petcare-done` — all authenticated with the per-device
    **widget token** (`widget_tokens`, migration 045) and all served by the same
    `api/widget.ts`. `petcare-done` (and the app-side `petcare-notify`) also
    fan a SILENT push (`{type:'petcare'}`) to every other member's device;
    `backgroundNotifications.ts` catches it and reloads their PetCare widgets —
    that's the cross-device "breakfast just got marked done" ASAP path. Prefer this over App-Group-only data for
    anything that GOES STALE: a mirrored snapshot only updates when someone opens
    the app, so a widget fed only by the App Group shows yesterday's data on a
    phone that wasn't opened. **Never bake a formatted date into a payload** —
    derive it in Swift from `Date()`, or it can't self-correct at midnight.
    `today_cfg` (see `syncTodayConfig`) is the reference for "mirror the config
    the widget needs to fetch for itself," and TodayWidget's `buildToday()` for
    "live → last-good cache → app snapshot, and only if it's still the same day."
- Icons: `lucide-react-native`. Images: `expo-image` + `@/lib/signedUrls`. Dates:
  `@react-native-community/datetimepicker`. Camera/photos: `expo-image-picker` +
  `expo-image-manipulator`. Files: `expo-document-picker` + `expo-file-system`
  (SDK 56 `new File(uri).arrayBuffer()`). Face ID: `expo-local-authentication`.

## Module layout
`src/app/<route>.tsx` is the screen entry (replaces the old placeholders);
implementation lives in `src/apps/<id>/`. Nested routes use folders
(`src/app/budget/[budgetId]/[monthId].tsx`, `src/app/pets/[petId].tsx`).

## Whereabouts (family location) — Phase 1
Live family map (route `/location`, hub tile "Whereabouts"). **Native-only**: the
map (`@rnmapbox/maps`) and background location (`expo-location` +
`expo-task-manager`) need a dev build + Mapbox tokens — see `WHEREABOUTS-SETUP.md`.
- `member_locations` (migration 065) — one row per member: latest fix + `sharing`
  / `paused_until`. Household-scoped RLS + Realtime. **Sharing is OFF by default
  (opt-in); we null coordinates on stop/pause so no stale location leaks.**
- `src/lib/location.ts` — data + logic: fetch/upsert my fix, `setSharing` /
  `pauseSharing` / `resumeSharing`, foreground `captureAndUpload`, Mapbox
  `driveEta`, `haversineMeters`, `formatDistance`/`formatEta`, nav deep-links.
  Keep `@rnmapbox/maps` imports OUT of here (screens only).
- `src/lib/locationTask.ts` — the background TASK (module-scope `defineTask`, same
  pattern as `backgroundNotifications.ts`); `registerLocationTask()` runs in
  `_layout`. `startBackgroundUpdates` takes localized foreground-service labels.
- `src/apps/location/` — `Whereabouts` (map + bottom sheet, owns the data + one
  Realtime channel), `MemberSheet` (detail — **leads with drive-time ETA**, then
  distance/battery/address, navigate, nudge/call), `SharingControls` (toggle +
  pause), `locationUi` (member colors, ringed avatar, battery chip, `timeAgo`).
- Native config lives in `app.config.js` (layered on `app.json`): Mapbox plugin
  (`RNMAPBOX_DOWNLOAD_TOKEN` build secret), expo-location background, iOS
  `UIBackgroundModes: ["location"]` + Always strings, `LSApplicationQueriesSchemes`
  (comgooglemaps/waze), Android location perms. Runtime map/Directions token is
  `EXPO_PUBLIC_MAPBOX_TOKEN`.
- **Live mode** (migration 066, `src/lib/liveLocation.ts`): opening a member's
  detail writes a `location_live_requests` row (heartbeated while open); the
  target device runs `useLiveResponder` (mounted in `_layout`) and, WHILE
  SHARING, ramps up to a high-accuracy `watchPositionAsync` burst so their pin
  moves near real-time, then relaxes when the request expires. Being watched
  never turns sharing on. The MemberSheet ETA/address refetch on a coarse ~100 m
  grid so live updates don't spam the Directions API.
  - **Background wake**: each live request also fires a SILENT push
    (`api/ack-ping.ts` `?action=live-wake` → `backgroundNotifications.ts` →
    `captureLiveFixIfSharing`) so a watched member whose app is asleep still
    refreshes. Needs the Vercel API DEPLOYED + expo push tokens (migration 039).
    iOS throttles silent pushes, so background freshness is best-effort (periodic
    bursts, not continuous); continuous smoothness still needs the target app
    foreground (the `useLiveResponder` watch).
- **Places & geofences (Phase 2)** — migration 067 (`places` + `place_events`),
  `src/lib/places.ts` (CRUD + `recordPlaceEvent`) and `src/lib/placesTask.ts` (the
  module-scope geofence TASK + `syncGeofences`). Each member's device monitors the
  household's places via OS region monitoring (cheap on battery); crossing one is
  recorded by THAT device (RLS only allows recording your own crossings), which
  drives the Activity feed via Realtime and pushes "Emma arrived at School" via
  `api/send-ping.ts` (`?action=place-event`, respects the place's notify flags).
  UI: `PlacesSheet` (Places / Activity tabs) + `PlaceForm` from the Whereabouts
  header. Gotchas: **iOS caps monitored regions at 20** (`MAX_REGIONS`) and
  enforces a ~100 m radius floor; geofences bounce at the boundary, so
  `recordPlaceEvent` drops a repeat of the same crossing within 5 min. A new place
  pins to your CURRENT location (no map-drag picker yet). Push copy is English-only.
- **Safety Radius / event mode (Phase 3, One Roof PLUS)** — migration 068
  (`safety_watches`, one row per owner), `src/lib/safetyRadius.ts` (CRUD +
  `isOutside` + `circlePolygon` + `alertBreach`) and `SafetyRadiusSheet`.
  Drop a circle centred on yourself, pick who to watch, get alerted when one
  crosses out. **Breach detection runs on the WATCHER's device** in
  `Whereabouts` against the live `member_locations` feed — no server job — and
  alerts via a LOCAL notification (the watcher detects it, so no push needed).
  Alerts fire once per crossing (the member must come back inside to re-arm).
  While a watch runs, watched members are kept in live mode (`requestLive`) so
  the boundary check has fresh positions. The circle is drawn as a real GeoJSON
  polygon (`circlePolygon`) because Mapbox circle radii are in PIXELS, not metres.
  Gating: `usePlus().isPlus` — non-Plus shows a `Sparkles` badge and routes to
  `/paywall`. Watches are household-readable on purpose (being inside someone's
  radius isn't a secret) and auto-expire after `WATCH_HOURS` (4h).
- **UI gotchas (learned the hard way)**:
  - **Never render a second `<Modal>` as a SIBLING of an already-open one** — on
    iOS it silently fails to present and the button just looks dead. (Real bug:
    "Add a place" did nothing because `PlacesSheet` rendered `PlaceForm`'s Modal
    as a sibling.) Render the sub-panel INSIDE the open Modal — either as another
    `<Modal>` nested in its children (what `NudgeSettings` → `PresetEditor` does)
    or as an absolutely-positioned overlay (what `MemberSheet`'s nudge picker does).
  - The roster is a HORIZONTAL card scroller so the sheet's height is constant
    for any household size; **your own card is the sharing-controls entry point**
    (hence no sharing button in the header).
  - Sheet/modal containers use **`c.sheet`, NEVER `c.card`** — the glass skin
    makes `card` translucent, so the map bleeds through the panel's own text.
    Same for labels drawn on top of the map (the place pills).
  - Radius pickers use `radiusPresets(min)` from `lib/location.ts`, which authors
    round labels **per unit system** (500 ft / ¼ mi vs 250 m) rather than
    converting metres — running 150 m through `formatDistance` gives a US user
    "492 ft", which reads as broken. Places passes a **100 m floor** (the iOS
    geofence minimum); Safety Radius has no floor because it's detected
    client-side. `nearestPreset()` keeps a chip highlighted when a saved value
    doesn't match the current unit system's presets.
  - Mapbox's logo AND the OSM attribution must stay visible — Mapbox ToS plus
    OpenStreetMap's **ODbL license** (removing attribution is a license breach,
    not just a ToS one). They're positioned bottom-left above the roster sheet.
- Not yet: location history (7-day retention, must be clearly surfaced to users)
  and driving/SOS check-in; a map-drag picker for placing/moving a place.

## AI / server endpoints
Native calls the deployed Vercel API via `process.env.EXPO_PUBLIC_API_BASE`
(`https://one-roof-app.vercel.app`) with `Authorization: Bearer <session token>`:
`/api/scan-receipt` (Budget), `/api/suggest-ping` (Nudges), and `/api/ack-ping`
(silent push to a nudge's sender when acked — see the widget note above). The
Nudges *widget* itself talks to `/api/widget-nudge` directly from Swift, using
a per-device widget token instead of a Supabase session (migration 045); the
Today widget uses the same token against `/api/widget?action=today` to pull
today's agenda on its own timeline. Both are served by one `api/widget.ts` —
`/api/widget-nudge` is a `vercel.json` rewrite onto it, kept forever because the
shipped App Store build posts to that exact URL. Push fan-out and Google
Calendar sync still need server work (see the TODO doc).

**`api/` is NOT covered by any build gate** — `tsconfig.app.json` only includes
`src`, and Vercel compiles the functions at deploy. Type-check a new/changed
function by hand before committing:
```
npx tsc --noEmit --ignoreConfig --esModuleInterop --skipLibCheck \
  --module esnext --moduleResolution bundler --target es2022 --strict \
  --types node api/<file>.ts
```
**And `api/` is capped at 12 files on Vercel Hobby — it is currently AT 12.** A
new endpoint must fold into an existing function behind `?action=`; see the root
`CLAUDE.md` "Build, deploy, git".

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
