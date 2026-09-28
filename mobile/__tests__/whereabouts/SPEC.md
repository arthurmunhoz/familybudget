# Whereabouts — behavioural spec for the location tests

Written **from the product intent and the platform contracts, not from the
implementation** (2026-09-28). The tests in this folder encode it; when a test
and the code disagree, the spec wins unless the spec is wrong about the
platform — fix the spec in the same commit, with the reason.

The promise the feature makes: *"when sharing is on, my family sees where I am,
recent enough to be useful, on Android exactly as on iPhone — including when my
app is in the background or has been swiped away."*

## Ground truth that motivated this (production, 2026-09-28)

- Arthur's Android (Galaxy S9+, `SM-G9650`) last wrote `member_locations` on
  2026-09-26 02:44 UTC; its last geofence crossing was 2026-09-23. Zero Android
  requests of any kind reached Supabase in the following 24 h log window.
- Over the same window the household's iPhones upserted every ~5 min in motion.
- Realtime publication, RLS and the Android push token were all present — the
  **reader side was fine; the Android writer went silent**.

## Platform facts the spec relies on

- **P1 — Android runs background tasks in a HEADLESS JS context.** When a
  location/geofence/notification event arrives and the Activity isn't alive
  (swiped away, killed by the OS, after the service restarts), the bundle's
  entry module runs but **nothing renders** — no `_layout.tsx`, no hooks, no
  effects. iOS relaunches the app with its root view, which is why code that
  only runs from the React tree "works on iPhone".
- **P2 — `expo-task-manager` auto-unregisters an undefined task.** If a task
  fires and `TaskManager.defineTask` wasn't called in that JS context it calls
  `unregisterTaskAsync(taskName)` (`node_modules/expo-task-manager/src/TaskManager.ts`).
  One headless event without the definition = location updates stop for good,
  until something re-registers them.
- **P3 — Android throttles background location to a few fixes per hour** unless
  the updates run from a **foreground service** (Android 8+). Android 14 also
  requires `FOREGROUND_SERVICE_LOCATION` + `foregroundServiceType="location"`.
- **P4 — Android 11+ requires foreground location BEFORE asking for
  background**, as a separate request; background is granted in Settings
  ("Allow all the time"). Android 10 shows it in the dialog.
- **P5 — A silent (data-only) push reaches a killed Android app only through a
  background-notification task**, itself defined headless per P1/P2. Its
  payload is the serialized FCM message — `{ data: { body: '<json>',
  dataString }, notification: null }`, or that wrapped under `notification` on
  the JobScheduler path — NOT iOS's `notification.request.content.data`.
- **P6 — `LocationTaskService` is `START_REDELIVER_INTENT`**: an OS kill brings
  the service back in a NEW, headless process (P1 → P2 bites exactly here).
- **P7 — expo-location refuses a `foregroundService` (re)start unless the app
  is foregrounded** (`ForegroundServiceStartNotAllowedException`, all Android
  versions). Background code can only re-register WITHOUT the service block;
  a foreground resume must put it back.

## Requirements

### A. Native config (Android) — `config.android.test.js`
- A1 Permissions: `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`,
  `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`,
  `FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS`.
- A2 None of those is in `blockedPermissions`.
- A3 `expo-location` plugin with `isAndroidBackgroundLocationEnabled` and
  `isAndroidForegroundServiceEnabled` both `true`.
- A4 `expo-notifications` plugin is configured (silent live-wake + alerts).
- A5 The location service merged in from expo-location is declared with
  `foregroundServiceType="location"` (required from Android 14).

### B. Headless task availability (P1/P2) — `headless.test.ts`
- B1 Evaluating the app's **entry module** (package.json `main`) WITHOUT
  rendering React defines the background-location task.
- B2 …and the geofence task.
- B3 …and the background-notification task (live-wake).

### C. Starting background updates on Android — `backgroundUpdates.test.ts`
- C1 Updates start via `startLocationUpdatesAsync` with a `foregroundService`
  (title + body) so they aren't throttled (P3), and `killServiceOnDestroy`
  is not `true` (swiping the app away must not end sharing).
- C2 Accuracy at least `Balanced`; a `timeInterval` (Android) no longer than
  5 min; `distanceInterval` no more than 100 m.
- C3 (Android) On foreground resume with sharing on, an ALREADY-registered task
  gets its options re-applied (P6/P7: the service may be gone), keeping the live
  cadence if a watcher has the device ramped.
- C4 Cold launch with sharing on + permission granted + task NOT running
  (e.g. after P2 unregistered it) → updates are started again.
- C5 Cold launch with sharing OFF → nothing is started (privacy).
- C7 The foreground-service block is never dropped for lack of stored labels.

### D. The background task handler, run headless — `taskHandler.test.ts`
Run in a fresh module registry (headless has no in-memory state from the UI).
- D1 A batch of fixes → exactly one upsert of the NEWEST fix into
  `member_locations` with lat/lng/accuracy.
- D2 An `error` payload → no throw, no write.
- D3 Sharing turned off (or paused) in the DB → no position written.
- D4 Signed out → no throw, no write.
- D5 The first fix in a fresh headless process is written (no throttle state
  that assumes a warm UI process).
- D6 A stationary phone's fix 20 min later is still written (fresh "last seen").

### E. Permission flow — `permissions.test.ts`
- E1 Asking for background permission asks for foreground first (P4).
- E2 Foreground denied → background is not requested, result is "not granted".

### F. Live wake (P5) — `liveWake.test.ts`
- F1 A data-only `live-wake` push handled by the background-notification task
  captures a fresh fix and writes it when sharing is on.
- F2 …and writes nothing when sharing is off.
- F3 Both Android payload shapes (P5) reach that path; F4 iOS's shape still does.
- F5 In the background (P7) a failed ramp doesn't cost the burst's fix.
- F6 Relaxing after a watch, in the background, really returns to the saver cadence.

## Needs a real device (can't be proven in Jest)
- Samsung "Sleeping apps"/battery optimisation killing the service; the
  persistent notification actually showing; OEM-specific kill behaviour.
- Real FCM delivery of the data-only push; real GPS fix cadence.
The device protocol for those lives in `DEVICE-TEST.md`.

## Spec corrections made while running it (the spec was wrong, not the code)

- **A1/A3** first checked only `app.config.js`'s own lists. `POST_NOTIFICATIONS`
  comes from expo-notifications' library manifest (manifest merge), and the
  expo-location plugin defaults the foreground-service flag to the background
  one — the tests now check the effective values.
- **C3** first said "no background updates without background permission". On
  Android a location FOREGROUND SERVICE started from the foreground needs only
  while-in-use permission (it's how navigation apps work), and sharing is gated
  on background permission at the switch anyway. Replaced by the re-apply rule.

## Result against the code as it was (commit d7c686b)

11 of the tests failed on the original code — B1, B2, B3 (tasks undefined
headless → auto-unregistered), C3×2 + C4 (a lost service is never restored;
old options never upgraded), C7 (labels missing → no foreground service), D1
(older fix could win a batch), F3×2 + F4 (Android live-wake payload ignored).
F5/F6 were written after tracing P7 and failed against the intermediate fix.
