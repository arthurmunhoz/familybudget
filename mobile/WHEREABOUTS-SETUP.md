# Whereabouts (family location) — setup

Phase 1 of the family-location feature: a live map of everyone in the household,
tap-a-member detail that **leads with drive-time ETA** (+ distance, battery,
address), one-tap navigation (Apple Maps / Google / Waze), and sharing controls
(on/off + pause). Native-only (iOS + Android) — a PWA can't do background
location. Map + routing are **Mapbox**.

## What's already done (in code, verified by the build gate)

- **DB**: `member_locations` table (migration 065) — one row per member, latest
  fix + `sharing`/`paused_until` state, household-scoped RLS, Realtime. Applied
  to the project and mirrored in `supabase/migration-065-member-locations.sql`.
- **App**: registered in the hub as **Whereabouts** (`/location`), i18n in
  en/es/pt, screens in `src/apps/location/`, logic in `src/lib/location.ts`, the
  background task in `src/lib/locationTask.ts`.
- **Native config**: `app.config.js` layers Mapbox + expo-location (background)
  onto `app.json` (iOS `UIBackgroundModes: ["location"]`, Always-permission
  strings, `LSApplicationQueriesSchemes` for the nav apps; Android
  fine/background/foreground-service permissions).

## What YOU need to do to run it on a device

1. **Create a Mapbox account** → https://account.mapbox.com/. You need two tokens:
   - a **public** token (`pk.…`) — read at runtime for the map + Directions;
   - a **secret download** token (`sk.…`) with the `DOWNLOADS:READ` scope —
     needed only at build time to fetch the native SDK.

2. **Set the env vars** (never commit them):
   - `mobile/.env.local` (git-ignored, loaded by Expo):
     ```
     EXPO_PUBLIC_MAPBOX_TOKEN=pk.your_public_token
     # optional — a custom Mapbox Studio style (e.g. a Warm Hearth theme).
     # Omit to use the standard light/dark styles.
     EXPO_PUBLIC_MAPBOX_STYLE_URL=mapbox://styles/you/your_style_id
     ```
   - your shell / EAS secret for the build:
     ```
     export RNMAPBOX_DOWNLOAD_TOKEN=sk.your_secret_download_token
     ```
     (EAS: `eas secret:create --name RNMAPBOX_DOWNLOAD_TOKEN --value sk.…`)

3. **Make a dev build** — Mapbox and background location are native modules, so
   Expo Go won't work:
   ```
   cd mobile
   npx expo prebuild --clean          # applies app.config.js into ios/ + android/
   npx expo run:ios                   # or run:android, on a device/simulator
   ```
   or an EAS dev build: `eas build --profile development --platform ios`.

4. **Grant "Always" location** when prompted (turning on sharing asks for it).

## What still needs a real device (can't be verified in the agent harness)

- Actual GPS fixes, the map rendering, live pins updating over Realtime.
- Background delivery (iOS batches/pauses these — best-effort by OS design).
- The Mapbox Directions ETA call and the Maps/Waze/Google hand-off.
- Permission prompts and the Android foreground-service notification.

## Not in Phase 1 (next up)

- **Places / geofences** + arrive/leave push ("Emma arrived at School") — Phase 2.
- **Safety Radius / event mode** (a One Roof **Plus** feature), location history,
  driving/SOS — Phase 3.

See the design brief for the full roadmap.
