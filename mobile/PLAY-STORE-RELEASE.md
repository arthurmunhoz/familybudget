# One Roof — Google Play release requirements

Scope: shipping a **native Android build of `mobile/` via EAS** (not a TWA wrapper
of the PWA). Everything below was verified against this repo on 2026-08-17, not
copied from a generic checklist — file references are real and the gaps are real.

Companion doc: `APP-STORE-LISTING.md` (Apple copy; most of the store text is
reusable, the character limits differ).

---

## 0. The timeline constraint — start this first

Your Play account is a **personal/individual** account, so before you can even
*apply* for production access Google requires:

- a **closed testing** track running
- with **at least 12 testers opted in**
- who stay opted in **14 continuous days**

Then you apply for production access, which is a manual review that takes days,
not minutes. **Realistic floor is ~3 weeks from first closed-test upload to
public listing.** Nothing in the code blocks you from uploading a closed-test
build today, so the right order is:

1. Fix the four **must-fix** items in §1 (a day of work).
2. Upload an AAB to closed testing, recruit the 12 testers, start the 14-day clock.
3. Do the store listing, Data Safety, and declarations (§3–§4) while the clock runs.

Testers must accept the opt-in link and *stay* opted in. Use a Google Group as
the tester list so you can add people without a new release.

---

## 0b. Android v1 ships WITHOUT Whereabouts (decided 2026-10-11)

Arthur's call: the first Play release leaves the family map out. The feature is
built and tested (`__tests__/whereabouts/`, incl. the Android background fixes
of 2026-09-28) — it's switched off, not deleted. iOS keeps it.

**The switch:** `WHEREABOUTS_ON_ANDROID` in `mobile/app.config.js` (currently
`false`). Off, it does two things together, which is why it's one switch:
- **Native** — the Android build declares no location permission
  (`ACCESS_FINE/COARSE/BACKGROUND_LOCATION`, `FOREGROUND_SERVICE_LOCATION` are
  `blockedPermissions`, which also strips the ones Mapbox and expo-location
  declare) and no location foreground service (a config plugin removes
  expo-location's `LocationTaskService`). So **§3.1 does not apply to v1**, and
  the Data Safety form has no location (§3.2).
- **JS** — `src/lib/features.ts` reads it back (`extra.whereaboutsAndroid`): no
  hub tile, no Safety Radius banner, `/location` redirects home, and no
  background location / geofence / live-mode work — including tearing down
  anything an earlier test APK registered on the phone.
`__tests__/whereabouts/disabled.android.test.ts` pins all of that.

**What it does NOT touch:** a member's `member_locations.sharing` flag is
account-wide (it may be another device's), so it's left as is; and place-alert
pushes from iPhone members still reach Android watchers who subscribed earlier
(a tap just opens the app).

**Listing assets were changed to match** — Play rejects a listing that shows a
feature the app doesn't have: short + full description (§4), the feature
graphic (Calculator tile replaces Whereabouts), and the screenshot list
(`store/screenshots/raw/README.md`).

**To bring it back on Android:**
1. `WHEREABOUTS_ON_ANDROID = true` in `app.config.js` → new build (native config;
   no OTA path). `WHEREABOUTS_ANDROID=1` does the same for a one-off build.
2. Do §3.1 (background-location declaration + demo video — the shot list is
   there) and add precise location + Mapbox back to Data Safety (§3.2).
3. Restore the listing copy below and the two map screenshots
   (`store/screenshots/raw/README.md`), and put the Whereabouts tile back on the
   feature graphic (`git log -- mobile/store/play-feature-graphic.html`).
4. Run `DEVICE-TEST.md` on a real Android phone before submitting.

Parked listing copy for that release:

```
Short (80): Shared calendar, shopping list, budget, pets and a family map — under one roof

• WHEREABOUTS — see your family on a live map with real drive-time ETAs, and get a heads-up when someone reaches or leaves a place that matters: home, work, class, the vet. Sharing is OFF until you turn it on, you can pause it whenever you like, and it is only ever visible to your own household.

(Plus list) • Safety Radius — draw a zone around someone and know the moment they leave it
```

---

## 1.0 The Android package name is NOT the iOS bundle id ← read before any build

`android.package` is **`one.roof.family.organizer`**. The iOS bundle id stays
`com.oneroof.app`. They differ on purpose and must not be "tidied up" into
agreement.

Why: the first upload to Play was rejected with two errors that are the same
fact stated twice —

```
Your APK or Android App Bundle needs to have the package name one.roof.family.organizer
Remove conflicts from the manifest ... content provider authorities are in use
by other developers: com.oneroof.app.androidx-startup
```

The second is the real news: `androidx-startup`'s provider authority is derived
from the applicationId, and Play reports it as **claimed by another developer**
— so `com.oneroof.app` is not available on Play at all, by anyone but its
owner. And a Play app's package is immutable after the console entry is
created, so the listing could not be moved to meet the build either. The build
had to move.

**Changing it has one hard prerequisite: Firebase.** `google-services.json`
registers clients per package, and ours holds only `com.oneroof.app`. The Google
Services Gradle plugin FAILS the build with "No matching client found for
package name" when there's no match — so a rebuild without this step does not
produce a broken app, it produces no app:

1. Firebase console → the SAME project (`one-roof-family-organizer`) → Add app →
   Android → package `one.roof.family.organizer`. Keep the old client; one
   project holds many, and the downloaded file will carry both.
2. Download the new `google-services.json` over `mobile/google-services.json`.
3. Re-upload it to EAS, since the builder reads the env var, not your disk:
   ```
   npx eas env:delete GOOGLE_SERVICES_JSON --non-interactive
   npx eas env:create --name GOOGLE_SERVICES_JSON --type file \
     --value ./google-services.json --visibility secret --scope project \
     --environment production --environment preview --environment development
   ```
4. Rebuild.

Knock-on effects, all one-time:
- **RevenueCat's Play app must use `one.roof.family.organizer`** when you wire
  billing (§1.5) — the store app is keyed by package name.
- **Any sideloaded APK on your phone is a different app now.** The old package
  won't be replaced or upgraded; uninstall it or you'll have two One Roofs.
- **Google sign-in is unaffected** — it runs Supabase's OAuth in a browser and
  returns via the `oneroof://` scheme, so there's no SHA-1 or package
  registration tied to it.
- **iOS is untouched.** Its bundle id, App Group (`group.com.oneroof.app`) and
  widgets all key off the Apple id, which has not changed.

---

## 1. Must-fix in the app before submitting

These were real defects or blockers on Android, verified in the tree. **All four
are now DONE in code** — what remains is the console work called out in §1.1.

### 1.1 FCM credentials — without this, zero push notifications ✅ done

Android push goes through Firebase Cloud Messaging; Expo's push service can't
deliver to Android without FCM V1 credentials. Everything push-driven dies
silently otherwise: Nudges fan-out (`api/send-ping.ts`), the daily digest
(`api/send-digest.ts`), ack pushes and Whereabouts live-wake (`api/ack-ping.ts`).

`app.config.js` now attaches `android.googleServicesFile` **only when
`mobile/google-services.json` exists**. Setting it unconditionally would make
`expo prebuild` and EAS fail on the missing file, so it self-wires: drop the file
in and Android push works; leave it out and iOS builds are unaffected. The file is
gitignored, so EAS needs it supplied.

✅ **Done, all three parts** (2026-08-22):

| Piece | Where it lives | What it does |
|---|---|---|
| `google-services.json` | EAS file env var, compiled into the app | lets the app register with FCM and get a token |
| FCM V1 service account key | Expo credentials, per app identifier | lets Expo's push service authenticate to FCM and send |
| Android channels | `src/lib/notifications.ts` (§1.3) | decides whether a push arrives as a heads-up |

All three are required and each fails silently on its own, which is why "push
doesn't work on Android" was never one bug.

Two things cross-checked, because both fail at SEND time rather than at upload
— i.e. the build succeeds, the app looks healthy, and nothing ever arrives:

- The service account's project (`one-roof-family-organizer`) matches
  `project_info.project_id` in `google-services.json`. ✅
- `google-services.json` contains a client for `one.roof.family.organizer`, the
  package actually being built. ✅ (It also still carries `com.oneroof.app` for
  the App Store build — see §1.0 for why the two differ.)

**The FCM key is per application identifier.** It was added under
`one.roof.family.organizer`; a key sitting on the old identifier does nothing
for the build on Play. Same trap as the keystore.

⚠️ **A gitignored `google-services.json` is NOT enough.** EAS warns
*"not checked in to your repository and won't be uploaded to the builder"* and then
builds without it — push dies silently and the build still succeeds. The supported
route is an EAS **file** env var, which materialises the file on the builder:

```
npx eas env:create --name GOOGLE_SERVICES_JSON --type file \
  --value ./google-services.json --visibility secret --scope project \
  --environment production --environment preview --environment development
```

`app.config.js` reads `process.env.GOOGLE_SERVICES_JSON` first and falls back to the
local file, so `expo prebuild` / `run:android` still work off disk. Confirmation that
it is wired: the "won't be uploaded to the builder" warning disappears from
`eas build` output.

No server change needed — `exp.host/--/api/v2/push/send` handles both platforms
off the same Expo token, and the expo-token table is already platform-agnostic.

### 1.2 Notification icon rendered as a solid white square ✅ done

Verified via `npx expo config --type introspect`: the manifest points
`expo.modules.notifications.default_notification_icon` and
`com.google.firebase.messaging.default_notification_icon` at
`@drawable/notification_icon`, which was generated from
`icon: "./assets/images/icon.png"`. That file measured **100% opaque with 1431
distinct colours** — and Android draws notification small icons as a **silhouette
from the alpha channel**, so it would have rendered as a plain white square.

Expo 56's docs require "96x96 all-white png with transparency". `public/roof-badge-96.png`
— the glyph the PWA already uses for exactly this purpose — measured 96×96, pure
`(255,255,255)`, 23% alpha coverage: already precisely the required format. Copied
to `assets/images/notification-icon.png` and the plugin now points at it, so both
clients share one canonical badge shape. `color: "#c2603f"` was already correct and
now has real alpha to tint.

### 1.3 No Android notification channels ✅ done

`setNotificationChannelAsync` appeared nowhere in `src/`. On Android **importance is
a property of the channel, not the message**, so a `high_priority` Nudge arrived at
default importance — no heads-up banner, no sound override — silently defeating the
one feature where urgency is the entire point.

Expo 56's docs also revealed a **second, worse bug**: on Android 13+ the OS
permission prompt does not appear until at least one channel exists, and
`getExpoPushTokenAsync` requires one. So the old order (request permission → get
token) meant an Android user was **never even asked** for notification permission.

`src/lib/notifications.ts` now exports `ensureAndroidChannels()`, creating a
`default` channel (DEFAULT importance) and an `urgent` one (MAX importance +
vibration), called **before** the permission request and before all three
`getExpoPushTokenAsync` call sites. `api/send-ping.ts` routes high-priority nudges
to `urgent` and everything else to `default`; `api/send-digest.ts` uses `default`.

> **Cross-repo contract:** the channel id strings are shared between
> `ANDROID_CHANNEL` in `mobile/src/lib/notifications.ts`, the `channelId` unions in
> `api/send-ping.ts` + `api/send-digest.ts`, and `defaultChannel` in `app.json`.
> Renaming one without the others silently drops pushes into an OS-named channel.

### 1.4 Microphone permission dropped ✅ done

`app.json` declared `android.permission.RECORD_AUDIO` and `expo-image-picker`'s
plugin re-added it. Nothing in `src/` records audio. Microphone is a sensitive
permission; shipping an unused one invites a review question at best.

Removed from `android.permissions`, plus `microphonePermission: false` on the
`expo-image-picker` plugin — that path calls `withBlockedPermissions`, so the
introspected manifest now carries `RECORD_AUDIO` with `tools:node="remove"`,
actively preventing **any** library from merging it back in. Verified in the
resolved config.

### 1.4b The 30-day trial (migration 084) ✅ code done

Every **newly created** household now gets 30 days of Plus with no card, granted by
`create_household()`. Deliberately not retroactive — existing households, including
paying iOS users, are untouched.

It needed no new gating code: `household_is_plus()` already treats `expires_at` as
the guard, so the trial row (`plan='plus'`, `product='trial'`) opens every existing
gate and closes it on lapse. Verified against the live DB in a rolled-back
transaction: active trial → `household_is_plus` true; expired trial → false and the
member cap computes back to 4; and a purchase upsert cleanly replaces the trial row.

Because migration 059's trigger only fires on INSERT, a household that grew to 8
members during the trial **keeps all 8** after it lapses — it just can't add a 9th.
Nobody is ever removed.

`current_household_plan()` additively reports `trial_ends_at` and `trial_expired`,
which the client turns into `isTrial` / `trialDaysLeft` / `trialExpired`
(`src/lib/plus.tsx`). Two subtleties worth preserving if you touch it:
- A live RevenueCat entitlement **suppresses** the trial framing, because right
  after a mid-trial purchase the DB row still says `trial` until the webhook lands,
  and telling someone who just paid that their trial expires in 12 days reads as a
  failed payment.
- `trialExpired` is server-sourced rather than inferred from `!isPlus`, so "your
  trial ended" can never be shown to someone who never had one.

**Testing the countdown and the lapse:** `admin_start_trial(household, days)` re-arms
a trial on an existing household (admin only). Pass a negative number to simulate a
lapse — e.g. `select public.admin_start_trial('<household-uuid>', -1);`. It refuses
to overwrite a real purchase, so it can't resurrect a lapsed paid plan.

### 1.5 Plus on Android ✅ wired 2026-10-13 / ⚠️ service-account hand-off + one build left

`src/lib/purchases.ts` picks the store key by platform
(`EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` on Android, the iOS key on iOS); with no key
for the running platform it degrades to "free, paywall unavailable". The server
needs no changes: `api/revenuecat-webhook.ts` keys off `app_user_id` =
`household_id` and only records `store`, and the RevenueCat webhook is set to
**All apps, Production + Sandbox**, so Play events land in `household_subscriptions`
exactly like App Store ones.

**What exists now (all done 2026-10-13):**

| Where | What |
|---|---|
| Play Console → Subscriptions | `one_roof_plus` with base plans **`monthly`** (USD 4.99 / BRL 7.00, backwards compatible) and **`yearly`** (USD 39.99 / BRL 50.00), plus offer **`free-trial-7d`** on yearly (7-day free trial, "never had this subscription"). All **Active**. Other countries are Play's auto-conversion of the USD price. |
| RevenueCat → Apps | **One Roof (Play Store)**, package `one.roof.family.organizer` |
| RevenueCat → Products | `one_roof_plus:monthly`, `one_roof_plus:yearly`, both attached to entitlement **`plus`** (NOT "One Roof Pro" — that one is the Test Store's) |
| RevenueCat → Offerings → `default` | `$rc_monthly` → `one_roof_plus:monthly`, `$rc_annual` → `one_roof_plus:yearly` (Lifetime has no Play product, so Android simply doesn't show it) |
| EAS env (prod/preview/dev, plaintext) | `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` (`goog_…`, publishable) |
| App copy | On Android the paywall's Terms link is Google Play's terms, and the restore / auto-renew lines say "Google account" / "Google Play → Payments & subscriptions" instead of "Apple ID" (`*Android` i18n keys) |

**Still to do (owner):**
1. Google Cloud project **`one-roof`** (`one-roof-500903`, the hotmail account — the
   Firebase project isn't visible to it) already has the Play Android Developer,
   Play Developer Reporting and Pub/Sub APIs enabled and a service account
   `revenuecat@one-roof-500903.iam.gserviceaccount.com`. It still needs roles
   **Pub/Sub Admin + Monitoring Viewer** and a **JSON key**.
2. Play Console → Users and permissions → invite that email with *View app
   information*, *View financial data* and *Manage orders and subscriptions* on One Roof.
3. RevenueCat → One Roof (Play Store) → upload the JSON → Save, then connect
   **Google developer notifications** (real-time renew/cancel events). Google can
   take up to ~36 h to accept new credentials; until then RevenueCat's product
   status reads "Could not check".
4. Ship a build (the key is compile-time — no `expo-updates`) to the **internal**
   track and buy with a **license tester** (Play Console → Settings → License
   testing) — sideloaded APKs can't reach Play Billing (`getOfferings()` returns
   nothing and the paywall reads "unavailable"). Confirm a `household_subscriptions`
   row with `store = 'PLAY_STORE'` appears.

The iOS key (`EXPO_PUBLIC_REVENUECAT_IOS_KEY`) is still NOT on EAS — iOS builds have
been local Xcode archives since July (they read `.env.local`). Add it before the
next EAS iOS build or that build ships the paywall dark.

### 1.6 Verify after `expo prebuild` (can't be confirmed from config alone)

- **`foregroundServiceType="location"`** on the background-location service. It
  did not appear in the introspected manifest; it may come from the library's own
  manifest at merge time. Android 14+ **crashes** a foreground service started
  without a declared type. Check `android/app/src/main/AndroidManifest.xml`.
- **`com.google.android.gms.permission.AD_ID`.** If RevenueCat or Play Billing
  merges it in, Play's Advertising ID declaration must say so — or block the
  permission. You don't use an ad ID, so blocking is cleaner.
- **`CAMERA`** and the storage permissions arrive via library manifest merge
  rather than the config plugin — confirm the final list matches what you declare.
- **Edge-to-edge.** Mandatory at targetSdk 35+, and Expo enables it by default.
  The app uses `react-native-safe-area-context` throughout, so it should be fine,
  but bottom action bars and sheets need a real-device pass (see §5).
- **Target API level.** Expo SDK 56 / RN 0.85 generates a current target
  (API 36 / Android 16), which clears Play's requirement for new apps. Confirm the
  generated `build.gradle` rather than assuming.

---

## 2. Already fine — no work needed

Worth knowing so you don't go looking:

| Thing | Status |
|---|---|
| `android.package` | `one.roof.family.organizer` — see §1.0; NOT the iOS bundle id |
| Adaptive icon | foreground + background + **monochrome** all present (`assets/images/android-icon-*.png`) — themed-icon ready |
| Splash screen | `expo-splash-screen` configured with light + dark |
| `versionCode` | `appVersionSource: "remote"` + `autoIncrement: true` — EAS manages it |
| Google sign-in | `makeRedirectUri({ scheme: 'oneroof' })` is platform-agnostic; Expo generates the Android intent filter from `scheme`. Same `oneroof://auth-callback` URL iOS already uses, so Supabase's allow-list needs nothing new |
| Apple sign-in button | correctly hidden off iOS via `appleAuthSupported` |
| Account deletion (in-app) | `delete_my_account` RPC, wired in `src/app/settings.tsx` — satisfies Play's in-app requirement |
| Backend / API | `EXPO_PUBLIC_API_BASE` already points at the deployed Vercel API; every `api/` endpoint is platform-agnostic |
| RevenueCat webhook | store-agnostic (see §1.5) |
| Mapbox | `@rnmapbox/maps` supports Android; `RNMAPBOX_DOWNLOAD_TOKEN` + `EXPO_PUBLIC_MAPBOX_TOKEN` are project-level EAS secrets, so they carry over |
| Android UI branches | date pickers, sheet radii, keyboard behaviour and `textAlignVertical` already have `Platform.OS === 'android'` paths — someone wrote this cross-platform-aware |
| Unused iOS-only deps | `expo-symbols` only appears in an unused Expo-template `collapsible.tsx`; `expo-glass-effect` and `@expo/ui` aren't imported anywhere. Nothing to strip |

---

## 3. Play Console declarations — the ones that will actually cost you time

### 3.1 Background location declaration ← highest rejection risk

> **Not for v1** — the Android v1 build declares no location at all (§0b).
> Keep this for the release that switches Whereabouts on.

You request `ACCESS_BACKGROUND_LOCATION`, which triggers Play's **Permissions
declaration form** and a genuinely strict review. It needs:

- A written justification of the core feature that requires it.
- A **demo video** (YouTube/Drive link) showing the in-app flow: the prominent
  disclosure, the user granting permission, and the feature working.
- **Prominent disclosure in-app** *before* the permission prompt: a screen that
  names the app, says location is collected in the background, and says what it's
  used for. This is a distinct requirement from the OS prompt and from your privacy
  policy — reviewers check for it specifically.

Your architecture is actually a good story here: sharing is **opt-in and off by
default**, visible only to the household, and `src/lib/location.ts` documents the
design. Say exactly that.

**Status: the disclosure screen exists — `src/apps/location/LocationDisclosure.tsx`.**
It was added on 2026-08-17; before that there was none (`SharingControls`
called `ensureBackgroundPermission()` straight from the toggle, so the OS prompt
was the first thing the user saw). Reference this exact screen on the
declaration form and film it in the demo video.

*Where it appears*: Hub → Whereabouts → the "Your location" sheet (tap your own
card) → flipping **Share my location** on. It also fires on **Resume sharing**
after a pause. Both paths run through `gate()` in
`src/apps/location/SharingControls.tsx`, which shows the screen and only calls
`ensureBackgroundPermission()` after the user taps **Continue** — it is skipped
only when Always-permission is already granted, i.e. when no OS prompt would
appear at all. Declining ("Not now") requests nothing and leaves sharing off.

*What the screen says* (en/es/pt, keys `location.disclosure.*` in
`src/lib/i18n/`) — full English text, for pasting into the declaration form:

> **Before you turn on sharing**
> One Roof collects location data to put you on your family's map and to tell
> your household when you arrive at or leave the places you save.
>
> **Even when the app is closed** — One Roof collects location data in the
> background — even when the app is closed or not in use — so your family's map
> and place alerts keep working while your phone is in your pocket.
>
> **Only your household** — Your location is shared only with the members of
> your household. It is never sold and never shown to anyone else.
>
> **You stay in control** — Sharing stays off until you turn it on, and you can
> pause it or turn it off at any time.
>
> Next, your phone will ask you to allow location access.
> \[ Continue ]  \[ Not now ]

*Demo video shot list* (matches the flow above): Hub → Whereabouts (map, sharing
off) → tap your card → "Your location" sheet → toggle **Share my location** →
**the disclosure screen** (hold on it) → **Continue** → the Android
location prompt → **Allow all the time** → back on the map with your own pin
live, then background the app and show a place alert arriving.

If the copy changes, change it in en/es/pt together, keep the "even when the app
is closed or not in use" clause, and re-record the video.

Also expect the separate **Foreground service permissions** declaration for
`FOREGROUND_SERVICE_LOCATION`, describing the same feature. The Android
foreground-service notification text is `location.fg.title` / `location.fg.body`
("One Roof is sharing your location with your household").

### 3.2 Data Safety form

The longest form. Based on what the app actually does, you're declaring collection
of: email + name, profile photos, **photos and documents**,
budget/spending amounts, pet records, calendar events, and a push token (device
identifier). *Financial info* counts as a sensitive category.

> **v1 (§0b): no location.** The Android v1 build has no location permission, so
> don't declare location and leave Mapbox out of the table below. When
> Whereabouts ships on Android, add **precise location** (sensitive) and the
> Mapbox row back.

Third parties data is shared with or processed by — all of which must be listed:

| Recipient | What | Why |
|---|---|---|
| Supabase | everything | backend / storage (first-party processor) |
| Anthropic | receipt & bill **photos** | `api/scan-receipt.ts`, `api/scan-bill.ts` vision scanning |
| Mapbox | location | map tiles + Directions ETAs — **not in v1 (§0b)** |
| Google Calendar | calendar events | opt-in two-way sync |
| RevenueCat | purchase data | subscription entitlement |
| Expo / FCM | push token | notification delivery |

Answer honestly on encryption in transit (yes) and deletion (yes — in-app, §3.4).
The Anthropic one is the item people forget; a photo leaving the device for
processing is data sharing even though it isn't retained for training.

### 3.3 App access ← the credentials you give Apple do NOT work here

The app is fully behind sign-in, and the production build offers exactly two
ways in: **Sign in with Apple** (iOS only) and **Continue with Google**. The
email/password path (`devSignIn` in `src/lib/auth.tsx`, wired to
`EXPO_PUBLIC_DEV_EMAIL`/`_PASSWORD`) is `__DEV__`-gated in
`src/components/Login.tsx` and **does not exist in a release build**.

So the App Store demo account — a Supabase email/password login like
`preview@oneroof.dev` — is **useless to a Play reviewer**: it isn't a Google
account, so it can't go through "Continue with Google", and the form it was made
for isn't in the build they get. Handing it to Play is a rejection.

Pick one before you fill in the App access form:

1. **Create a real Google account for review** (recommended). Any free Gmail,
   e.g. `oneroof.review@gmail.com`. Sign into it once on a device, let
   onboarding create a household, and seed that household with a couple of
   members, a budget, a pet and a place so the reviewer sees a working app
   rather than an empty one — this matters most for §3.1, where they have to
   watch background location actually do something. Then give Play the address
   and password under App access. No code change, and it uses the same path a
   real user takes.
2. **Ship email/password sign-in for everyone** — ungate `devSignIn` into a
   proper "Sign in with email" option. That's a product decision (password
   reset, account recovery, support load), not a review workaround, and it's a
   bigger change than the review needs.
3. **Declare "no special access required"** — technically true, since signup is
   open and any Google account lands in a fresh household via
   `create_household`. Weakest option: the reviewer sees an empty household with
   no other members, which makes the family-location feature they're scrutinising
   look like it does nothing.

Google sign-in needs no native Google client ID and no SHA-1 fingerprint:
`signInWithGoogle` runs Supabase's own OAuth in a browser tab
(`WebBrowser.openAuthSessionAsync`) and returns via the `oneroof://` scheme.
Confirm `oneroof://auth-callback` is in Supabase Auth → URL Configuration →
Redirect URLs before the reviewer tries it.

⚠️ **It was still broken on Android until 2026-08-17** — worth knowing, because
any test build made before that fix cannot sign in at all. `oneroof://auth-callback`
had no matching expo-router route, which iOS never exposed (its
ASWebAuthenticationSession swallows the redirect) but Android did: the redirect
Intent reopened the app onto expo-router's "Unmatched Route" screen with the
`?code=` visible and no session. Fixed by `src/app/auth-callback.tsx`. **Verify
Google sign-in end-to-end on an Android build before uploading** — a reviewer
who can't get past the login screen is an automatic rejection.

Anything gated behind Plus won't be reachable by a reviewer on Android until §1.5
lands — mention that in the notes rather than letting them find a dead end.

### 3.4 Account deletion URL

✅ Done. In-app deletion already existed (§2); Play *additionally* requires a
**web-accessible URL** where someone who has already uninstalled can request
account and data deletion. `public/support.html` now carries an anchored section
covering both routes — the in-app path and an email request for uninstalled users.

Give Play this URL:
`https://one-roof-app.vercel.app/support.html#delete-account`

The section satisfies all three things Play checks on that page: it names One
Roof, it spells out both routes (in-app, and email for someone who has already
uninstalled), and it states what is deleted, what is kept and for how long —
the last one being the bullet most pages miss. Keep all three if you edit it.

The "what is kept" wording tracks `delete_my_account()` (migration 078): a
member who ISN'T the last in their household leaves the household's shared
content behind, because budgets/lists/pets/documents belong to the household
row, not to the account. Say so plainly rather than implying everything goes.

⚠️ **It only goes live on the next `npx vercel deploy --prod`, and as of
2026-08-17 production still serves the OLD page** — no `#delete-account` anchor
and no email route. Deploy BEFORE pasting the URL into the Data safety form, or
a reviewer following it lands on a page that tells uninstalled users to open an
app they no longer have.

### 3.5 The remaining "App content" declarations

Mostly quick, but all of them block release until answered:

- **Privacy policy** → `https://one-roof-app.vercel.app/privacy.html` (already live)
- **Ads** → no ads
- **Content rating** → IARC questionnaire; expect the equivalent of Everyone/3+
- **Target audience** → 18+ (or 13+). Do **not** declare it child-directed — despite
  the name it's a household tool for adults, and Families policy adds significant
  extra requirements
- **Advertising ID** → declare none, and confirm `AD_ID` isn't merged in (§1.6)
- **Financial features** → none apply. You track spending the user types or
  photographs; you don't connect bank accounts, lend, or handle crypto
- **Health apps** → no. Pet records are not human health data
- **News / Government / COVID contact-tracing** → no
- **Data deletion** → point at §3.4's URL
- **User-generated content** → content is private to a household, not publicly
  broadcast, so the public-UGC moderation requirements shouldn't attach. Answer the
  form accurately and don't over-claim social features

---

## 4. Store listing assets

Text is largely reusable from `APP-STORE-LISTING.md`, but Play's fields differ:

| Field | Limit | Source |
|---|---|---|
| App name | 30 | `One Roof: Family Organizer` (26) — same as Apple |
| Short description | 80 | **new copy needed** — Apple's 30-char subtitle is too short to reuse |
| Full description | 4000 | adapt Apple's description; Play renders plain text, so drop the `•` styling if it looks rough |
| App icon | 512×512 PNG, 32-bit | ✅ `store/play-store-icon-512.png` |
| Feature graphic | **1024×500** | ✅ `store/play-feature-graphic.png` — built here, no Apple equivalent to reuse |
| Phone screenshots | 2–8, min 320px side | ⚠️ **you must shoot these** — `store/screenshots/raw/README.md` has the shot list; the compositor is built |
| Tablet screenshots | optional | `supportsTablet` is iOS-only config; skip unless you want tablet distribution |
| Privacy policy URL | — | already live |

Android screenshots are the only work left that needs a human, and only for
the capture step — see below.

### Screenshots — `store/screenshots/`

**These have to be shot on a real Android phone.** There is no Android SDK,
emulator or `adb` on this machine, and the iOS simulator tooling can't stand in
(it would show iOS chrome on a Play listing). What IS built is everything
either side of the capture:

- `screenshots/raw/README.md` — the eight shots to take, in the order Play
  shows them, each mapped to its caption. Also two warnings worth reading: use
  the review account's demo data rather than your own household (these images
  are public forever), and keep all eight in one theme.
- `screenshots/make-screenshots.py` — drops each capture onto a branded
  1080×1920 canvas with its caption in Hanken Grotesk, rounds the device
  corners, and asserts the output is RGB at the right size.

The size is not cosmetic: **Play requires phone screenshots between 16:9 and
9:16, and a modern Android capture is about 20:9** (1080×2340 = 0.46), which is
taller than 9:16 and gets rejected at upload. Compositing onto a fixed
1080×1920 canvas makes that impossible to get wrong.

Rendering goes through Chrome rather than PIL because the captions must use the
app's own UI face, and those font files are woff2 — which PIL cannot read.

### App icon — `store/play-store-icon-512.png`

⚠️ **The Android launcher icon was the Expo template's blue chevron** until
2026-08-20. `app.json` pointed `adaptiveIcon` at
`assets/images/android-icon-{foreground,background,monochrome}.png`, and all
three were still the scaffold's placeholder art — so the clay house only ever
appeared on iOS and in the stores, never on an Android home screen.

`store/render-app-icon.py` now renders every icon from one vector definition:
`icon.png`, `splash-icon.png`, the three adaptive layers, and the 512 Play
listing icon. Three things it gets right that are easy to miss:

- **The adaptive foreground is sized to the SAFE ZONE, not the canvas.** Android
  launchers pick their own mask, and only the middle 66% is guaranteed. The
  limit is the glyph's diagonal, not its width — at 490px wide on a 1024 canvas
  the half-diagonal is 325 against a safe radius of 341. A full-bleed glyph
  loses its eaves on a round launcher.
- **The monochrome layer is shape-only.** Android 13+ themed icons tint the
  alpha channel; colour in that file is ignored and then looks broken.
- **`icon.png` has no alpha, the adaptive layers must have it.** The script
  asserts both rather than hoping.

The doorway is a cut-out, not a filled or lit shape: a lit door was tried and
mushes together at 48dp, where the notch still reads.

### Feature graphic — `store/play-feature-graphic.png`

1024×500, RGB with **no alpha** (Play rejects transparency). Brand lockup on
the app's own clay gradient: the roof glyph, the Fraunces wordmark, the tagline
from the support page, and the module names as pills so a browsing user learns
what the app does without reading the description.

Paper field, with the roof drawn as one clay stroke arching over the eight
module icons — the name and the breadth of the app in a single image. The icons
come from the app's own `lucide` set, so they are the exact glyphs on the Hub.
(A louder clay-field alternative was built and rejected on 2026-08-19; it lives
in the history of this file if it's ever wanted back.)

It is not generated by hand — `store/play-feature-graphic.html` is the source
and `bash mobile/store/render-feature-graphic.sh` re-renders it through headless
Chrome at exactly 1024×500. The fonts are pulled from the web app's
`node_modules` at render time (the same Fraunces + Hanken Grotesk the app
ships, so the graphic can't drift from the product's type) and are deliberately
not committed. Edit the HTML and re-run rather than retouching the PNG.

Two constraints baked into the layout, worth keeping if you restyle it:
- **Nothing important within ~24px of any edge**, and the text block stays left
  of the artwork — Play crops this asset for some placements.
- **No price or promotional text** ("free", "30 days", "#1", "download now").
  Play disallows it in graphic assets, which is why the Plus trial appears only
  in the description.

### Short description (80 max) — 75

```
Shared calendar, shopping list, budget, pets and documents — under one roof
```

### Full description (4000 max) — 2463

Written for Play, not pasted from Apple. Four things had to change, and they're
the things to preserve if you edit it:

- **No feature Android v1 doesn't have.** That now includes Whereabouts and
  Safety Radius (§0b) — their copy is parked there for the release that brings
  them back.
- **No iOS-only features.** Apple's copy sells Home-Screen widgets, Apple
  Calendar sync and a "Face ID–locked vault". None of those exist on Android —
  widgets and Apple Calendar aren't built, and the lock is a fingerprint or face
  unlock. Promising them here is a listing that lies.
- **Plus features are named as Plus.** Receipt scanning is capped monthly on
  free, and Google Calendar sync, the vault lock, split-by-item, private budgets
  and Safety Radius are all Plus. They're described in the body and then
  attributed in the Plus block, mirroring the app's own paywall list
  (`settings.plusFeature*`), so nothing reads as free that isn't.
- **No kids framing.** A household here is couples, roommates and pets — see
  `marketing/fact-sheet.md`. Place examples are home/work/class/the vet, not the
  school run.
- **Only claims on the fact sheet.** Every bullet traces to a verified feature.
  No stats, no anecdotes.

```
Run your whole home from one app — not five.

One Roof keeps your household's shopping list, budget, calendar, pets, documents and everyday coordination in a single shared space. Everyone at home sees the same thing, in sync, instantly.

WHAT'S INSIDE

• SHOPPING LIST — add an item and watch it appear on everyone's phone. Group by store, tick things off as you shop, and keep adding even with no signal: your changes upload themselves once you're back online.

• MONEY — shared budgets by month, week or day, with categories you control. Photograph a receipt and the amount, date and category are filled in for you. See what your household really spends and saves, month after month, instead of starting from zero each time.

• SHARED CALENDAR — everyone's plans in one place, color-coded by person, with birthdays, anniversaries and renewal reminders.

• PET CARE — a shared daily checklist, so "did anyone feed the dogs?" stops being a question. Track medications and recurring care, log weight over time, and keep vet visits and vaccines with a reminder before the next one is due.

• DOCUMENTS — IDs, insurance, registrations and renewal dates kept together, so the number you need on a trip isn't buried in an old email.

• NUDGES — one tap to say "on my way", "dinner's ready" or "need a hand". You can see when someone has read it, and an urgent nudge carries a call button.

• FAMILY — everyone's details on one card: birthdays, phone numbers, sizes, blood types.

• CALCULATOR — split a bill evenly, compare unit prices in the aisle, and work out a discount without guessing.

A HOUSEHOLD IS WHOEVER LIVES UNDER YOUR ROOF

Couples, families, roommates — and the pets. One invite code brings everyone in.

PRIVATE BY DESIGN

No ads. No tracking. We don't sell your data — not now, not later. Each household's information is walled off inside the database, so it's visible to its members and to nobody else.

ONE ROOF PLUS

Every new household starts with 30 days of Plus included, no card needed. Plus adds:

• Unlimited AI receipt and bill scans
• Two-way Google Calendar sync
• A fingerprint or face lock on the Document Vault
• Split a bill by item, straight from a photo
• Multiple budgets, and private budgets only you can see
• Up to 12 people in your household

One subscription covers the whole home: you pay per household, never per person.

Available in English, Spanish and Portuguese.

Questions or ideas? one.roof.family.organizer@gmail.com
```


---

## 4b. Getting it onto your own Android phone today

This is the fastest loop and needs no Play upload. The `preview` profile is
`distribution: internal`, which builds an **APK** you can install directly:

```bash
cd mobile && eas build --platform android --profile preview
```

EAS prints a QR code / URL when it finishes — open it on the phone and install
(you'll need "install unknown apps" allowed for your browser). First Android build
also prompts to generate a keystore; let EAS manage it.

What works and what doesn't on that sideloaded build:

| | Works? |
|---|---|
| Sign in with Google, all six apps, the 30-day trial + countdown | ✅ |
| Push notifications (nudges, digest, urgent channel) | only after `google-services.json` + the FCM key are in place (§1.1) |
| Buying Plus | ❌ — needs an internal-testing track, see the note in §1.5 |
| Mapbox map | ✅ — but only from the NEXT build; see §4c |

**To see the trial**, sign in with a Google account that has no household — a fresh
account lands on Onboarding, and `create_household()` grants the 30 days. Signing in
as your existing account puts you in a household that predates the migration and has
no trial; use `admin_start_trial()` (§1.4b) to arm one there instead.

## 4c. Fixed: the blank Whereabouts map on the first Android build

**Symptom:** Whereabouts showed the roster and "Set EXPO_PUBLIC_MAPBOX_TOKEN and
rebuild the app to load the map" instead of a map.

**Cause:** `EXPO_PUBLIC_MAPBOX_TOKEN` existed only in `mobile/.env.local`, which is
gitignored — and an EAS cloud build uploads only git-tracked files, so it inlined as
`undefined`. `RNMAPBOX_DOWNLOAD_TOKEN` *was* already an EAS env var, which is why
the native Mapbox SDK compiled fine and only the runtime token was missing. That
combination reads as a broken map rather than a missing variable. Confirmed with
`eas env:list`: all three environments had the download token and nothing else.

**Fix applied:** `EXPO_PUBLIC_MAPBOX_TOKEN` created as a project EAS env var
(`plaintext`) in production + preview + development, and verified readable for
preview. `plaintext` is deliberate — a `pk.` token is compiled into the bundle and
readable from any APK, so `secret` would buy nothing and make it unverifiable.

**Needs a rebuild.** `EXPO_PUBLIC_*` values are inlined at build time and there is no
`expo-updates` in this project, so there is no over-the-air path:

```bash
cd mobile && eas build --platform android --profile preview
```

`.env.example` now documents every var and which ones EAS needs, and `CLAUDE.md`
carries the gotcha, so the next `EXPO_PUBLIC_*` var doesn't repeat this.

## 5. Build and submit

```bash
cd mobile && eas build --platform android --profile production
```

`eas.json`'s `production` profile already carries the Supabase + API env, and EAS
defaults to an **AAB** for the production profile, which is what Play requires for
new apps. EAS generates and holds the upload keystore; Play App Signing manages the
release key. Then:

```bash
cd mobile && eas submit --platform android --profile production
```

`submit.production` in `eas.json` is `{}` — the first `eas submit` will prompt for a
Google service-account JSON with Play Developer API access. Create it in Google
Cloud, grant it access in Play Console → Users and permissions, and store it as an
EAS secret so later submits are non-interactive.

**Device testing is not optional here.** Everything in this repo has been verified
on iOS and in a Chromium PWA preview; no part of the Android native build has ever
run. Before the closed test, walk a real Android device through: Google sign-in,
push arrival (nudge + urgent nudge), receipt scan camera flow, document scanner,
biometric vault unlock, the Mapbox map, background location, and bottom-bar layout
under edge-to-edge.

---

## 6. Known Android v1 gaps — ship or fix, but decide

Not blockers; they're parity gaps you should know about before someone reports them.

- **No home-screen widgets.** `targets/widgets/*.swift` is WidgetKit — iOS only.
  Android needs a separate Glance/AppWidget implementation. `api/widget.ts` is
  transport-agnostic, so the backend would be reusable.
- **Google sign-in only.** Apple sign-in is correctly hidden on Android, so a
  household member whose account was created with Apple can't sign in on an Android
  phone. Worth a line in the FAQ.
- **No Apple Calendar sync** (`isAppleCalendarAvailable` is iOS-gated). Google
  Calendar sync works and is the relevant one on Android — but it's Plus-gated, so
  it's unreachable until §1.5 lands.
- **Plus on Android needs a build carrying the RevenueCat key** (§1.5). Products,
  offering and key are in place; build 10 predates the key, so its paywall reads
  "unavailable". The 30-day trial covers new households until the next build.
- **No Whereabouts on Android v1** (§0b) — a deliberate scope cut, switched off
  in one place and ready to return.
- **`ACTIVITY_RECOGNITION`** may be requested by `expo-location` on Android. If it
  shows up in the merged manifest and you don't need it, block it rather than
  explaining it on a form.
