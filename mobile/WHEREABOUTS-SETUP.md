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
     # optional — custom Mapbox Studio styles (e.g. a Warm Hearth theme). If only
     # the first is set it's used for BOTH themes; add _DARK for a proper Dusk map.
     # Changing these needs a Metro restart: npx expo start --clear
     EXPO_PUBLIC_MAPBOX_STYLE_URL=mapbox://styles/you/your_light_style_id
     EXPO_PUBLIC_MAPBOX_STYLE_URL_DARK=mapbox://styles/you/your_dark_style_id
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

## Live mode (built) — deploy the API for the background wake

Opening a member's detail ramps THEIR device to high-frequency GPS while you
watch, so their pin moves smoothly. The foreground path works from the app alone.
The **background wake** — so a watched member whose app is asleep still refreshes
— fires a silent push via `api/ack-ping.ts` (`?action=live-wake`), so it only
works once the Vercel API is deployed. **Deploy from the REPO ROOT, not
`mobile/`** — `mobile/` is the Expo app, the Vercel project is the root (that's
where `api/` and `vercel.json` live):

```
cd <repo root>          # .../family-budget
npx vercel deploy --prod --yes
```

iOS throttles silent pushes, so background updates arrive as periodic bursts, not
a continuous stream; continuous smoothness needs the watched person's app in the
foreground. Test with **two devices** — you can't watch yourself.

## Places & geofences (Phase 2, built)

Save places (Home, School, Grandma's) from the **Places** button in the
Whereabouts header. Each member's device monitors them as native geofences, and
crossing one shows in the **Activity** feed and pushes "Emma arrived at School"
to the rest of the household.

- A new place pins to **your current location** (no map-drag picker yet), with a
  radius preset.
- **Watching is personal.** Creating or sharing a place notifies *nobody*. Each
  member opts in per place ("Notify me about this place") and chooses **whose**
  comings and goings they want to hear about — so you can watch the kids at
  School without your wife getting pinged every time you arrive.
- When someone is inside a place, their card reads **"At Home"** / "At Gym"
  instead of a distance.
- The arrive/leave **push** also needs the API deployed — from the **repo root**,
  not `mobile/` (see the deploy note above).
- Geofences only run for members who have **sharing on** and granted **Always**
  location, and they need the native build (already covered by your dev build —
  no new native modules, so a JS reload is enough for the app code).
- Real-world caveats: **iOS monitors at most 20 regions** per app and enforces a
  **~100 m minimum radius**; crossings can take a minute to fire and may bounce at
  the boundary (we drop repeats within 5 minutes). Push copy is English-only.

## Safety Radius (Phase 3, built — One Roof **Plus**)

The shield button in the Whereabouts header. Drop a circle centred on you, pick
which members to watch, and get alerted the moment one crosses out — the park /
fair scenario.

- **Plus-gated**: non-Plus users see a sparkle badge on the button and tapping
  opens the paywall.
- Alerts are **local notifications on your own phone** (your device does the
  detecting, so no deploy or push setup is needed for this one).
- An alert fires **once per crossing** — the person has to come back inside
  before they can trigger another.
- While a watch runs, the watched members are put in **live mode** so their
  positions are fresh enough for the boundary to mean something.
- The watch **auto-expires after 4 hours**, and is visible to the household on
  purpose (being inside someone's safety radius isn't a secret).
- Accuracy caveat: this is only as good as the watched member's location
  freshness — if their app is asleep and the silent-push wake is throttled, a
  crossing can be reported late.

## Not built yet (next up)

- **Location history** — 7-day retention, and it must be clearly surfaced to
  users (what's kept and for how long).
- Driving detection / SOS check-in.
- A map-drag picker for placing/moving a place.

See the design brief for the full roadmap.
