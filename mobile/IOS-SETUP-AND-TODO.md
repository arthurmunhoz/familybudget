# One Roof — iOS (React Native / Expo) build: status & your to-do list

This is the native iOS rewrite of the One Roof PWA, built with **Expo SDK 56 + expo-router**, reusing the existing **Supabase** backend. It was built autonomously and verified as far as possible **without a simulator** — i.e. it **type-checks (`tsc`) and the iOS bundle builds (`expo export`)**, but on-device behavior has **not** been run yet. Everything below tells you how to run it and exactly what only you can finish (Apple account, secrets, device testing).

Branch: `react-native-rewrite` · App lives in `family-budget/mobile/`.

---

## 1. Run it (5 minutes, on your Mac)

```bash
cd "Family Apps/family-budget/mobile"
npx expo start          # press i for the iOS simulator, or scan the QR with Expo Go on your iPhone
```
- `.env.local` is already created (Supabase URL/anon key + dev creds + API base). It's gitignored.
- On the login screen tap **Dev sign in** to enter the seeded test household (the Apple/Google buttons need the config in §3).
- Note: **Sign in with Apple, native push, and EAS builds require a real device + your Apple/EAS accounts** — the simulator + dev login are enough to click through every screen.

> Some features (Sign in with Apple, camera receipt scan, Face ID, push) only work in a **dev build** (`eas build --profile development`) or on a real device, not always in plain Expo Go. See §4.

---

## 2. What's built

**Foundation:** Warm Hearth theme (light/dark, follows system), tri-lingual i18n (EN/ES/PT-BR, device locale + saved preference), auth (Sign in with Apple + Google OAuth + dev login), shared UI primitives, hub launcher, Settings screen.

**Modules ported (functional, RN-native, reusing the Supabase backend + RLS):**
- Calculator, Shopping List (realtime), Pet Care (profiles, events, reminders, photos), Family (profiles, avatars), Calendar, Money/Budget, Nudges, Document Vault (Face ID). *(Per-module status + known gaps are in §6.)*

**Apple-required pieces scaffolded:** Sign in with Apple, in-app account deletion (Settings → Delete account, backed by the `delete_my_account` RPC), permission usage strings, native push registration.

---

## 3. YOUR TO-DO — things only you can do

### A. Apple Developer / App Store Connect
1. **Enroll** in the Apple Developer Program ($99/yr) if not already.
2. **Bundle identifier**: the app uses `com.oneroof.app` (in `app.json`). Change it if you want a different one (and keep `ios.bundleIdentifier` + `android.package` in sync). Then **register the App ID** in your Apple account with the **Sign in with Apple** capability enabled.
3. **App Store Connect**: create the app record (name "One Roof", the bundle id, primary language, category **Lifestyle**).
4. **APNs key** for push: Certificates → Keys → create an **APNs Auth Key (.p8)**; EAS will use it (it can also auto-manage this). Needed only when you wire push (§E).
5. **Privacy Nutrition Labels** (App Store Connect → App Privacy): declare Contact Info, User Content (receipts/vault/pet photos), Financial Info, Identifiers, and **disclose that receipt/bill images are sent to Anthropic**. Required before submission.
6. Ship **general-audience 4+** (NOT the Kids Category). The app carries **no ad/tracking SDKs**, so set "Data Not Used to Track You" / no ATT prompt needed.

### B. EAS (Expo Application Services) — builds & the push project id
1. `npm i -g eas-cli` then `eas login`.
2. From `mobile/`: **`eas init`** — this creates the EAS project and writes the **projectId** into `app.json` (`extra.eas.projectId`). **Push notifications won't register until this exists** (the Settings → Enable notifications button reports "Run `eas init` first" otherwise).
3. **Env vars for cloud builds**: `.env.local` is gitignored and is NOT uploaded to EAS. Make the `EXPO_PUBLIC_*` values available to builds either by adding an `env` block per profile in `eas.json`, or `eas env:create` (Supabase URL/anon key + `EXPO_PUBLIC_API_BASE`). (Drop the dev email/password from production builds.)
4. **Build a dev/preview app**: `eas build -p ios --profile development` (simulator/dev-client) or `--profile preview` (internal/TestFlight-style). Install on your iPhone and run through §6.
5. **Submit**: `eas submit -p ios` once you've validated.

### C. Supabase auth providers (so Apple/Google buttons work)
1. **Apple provider**: Supabase → Auth → Providers → Apple → enable; add your **Services ID / Team ID / Key** (from Apple). Native Sign in with Apple uses `signInWithIdToken` (already implemented) — it needs the Apple provider enabled with the **bundle id** as an allowed client.
2. **Google provider**: already enabled for the PWA. For the **native** OAuth redirect, add these to Supabase → Auth → **URL Configuration → Redirect URLs**: `oneroof://auth-callback` and `oneroof://`. (The app uses the `oneroof` scheme.)
3. After both, the Login screen's Apple/Google buttons should work on a real device/dev build.

### D. App assets / polish
- **App icon**: currently an **upscaled 512px** icon (`mobile/assets/images/icon.png`). Provide a crisp **1024×1024** PNG (no transparency) for store quality.
- **Fonts**: ✅ done — Fraunces (display) + Hanken Grotesk (UI) are loaded via `@expo-google-fonts/*` and applied through the `Txt` primitive. (Raw `<Text>` in a few sub-screens still uses the system font; minor.)
- **Splash**: a basic splash is configured (warm paper / espresso); refine if desired.

### E. Server-side follow-ups (Vercel `api/`, when ready)
- **Native push delivery**: ✅ implemented in code — `api/send-ping.ts` and `api/send-digest.ts` now also send to `expo_push_tokens` via Expo's push API, alongside web-push (per-recipient language, best-effort). **Pending: a Vercel deploy** (`npx vercel deploy --prod`) for it to go live, plus APNs (EAS provisions the APNs key during the iOS build, and the device must be registered via Settings → Enable notifications). Follow-up: prune stale Expo tokens from the send receipts.
- **Sign in with Apple — account-deletion token revocation**: ✅ implemented — `api/apple-connect.ts` captures the Apple refresh token at sign-in and `api/apple-revoke.ts` revokes it during account deletion (wired into the app at sign-in + Settings → Delete; migration 040 stores the token, service-role only). **You must set 4 Vercel env vars** for it to actually revoke (until then it's a safe no-op and deletion still works):
  - `APPLE_TEAM_ID` — your 10-char Apple Team ID.
  - `APPLE_KEY_ID` — the Key ID of a **"Sign in with Apple" key** (Apple Developer → Certificates, Identifiers & Keys → Keys → +, enable Sign in with Apple, download the `.p8`).
  - `APPLE_CLIENT_ID` — `com.oneroof.app` (your bundle id).
  - `APPLE_PRIVATE_KEY` — the **contents of the `.p8` file** (paste the whole `-----BEGIN PRIVATE KEY----- … -----END PRIVATE KEY-----`; literal `\n` escapes are fine).
  Then deploy the PWA. Untested end-to-end — verify on a device once the env vars are set.
- **Google Calendar native connect**: the two-way sync endpoints exist for web; the native "Connect Google Calendar" button is stubbed. Wiring it needs the OAuth redirect handled in-app (or a WebBrowser flow) plus the existing `/api/google-calendar-*` endpoints.

### F. Paywall / IAP (when you're ready to charge)
- Not built yet. Plan (from the strategy): **RevenueCat + Apple IAP**, per-household "One Roof Plus" at $4.99/mo · **$39.99/yr** · $79.99 lifetime, 7-day trial after a value moment. Add `react-native-purchases`, gate the cost-bearing features (unlimited AI scans, vault, calendar, unlimited pets/budgets), and tighten the free AI scan cap (10–20/mo) in `ai_config`.

---

## 4. Apple App Review checklist (status)
- ✅ **Sign in with Apple** (4.8) — implemented (needs §3 Supabase Apple provider + §A capability).
- ✅ **In-app account deletion** (5.1.1(v)) — Settings → Delete account; Apple token revocation now implemented (needs the 4 `APPLE_*` env vars in §3.E to fully activate).
- ✅ **Not a website wrapper** (4.2) — true native RN app.
- ✅ **Permission usage strings** — Face ID, camera, photos, calendar in `app.json`.
- ⏳ **Privacy Nutrition Labels** — fill in App Store Connect (§A.5).
- ⏳ **Native push (APNs)** — device registration done; **send side implemented in code, pending a Vercel deploy** (§E).
- ⏳ **No ad/tracking SDKs** — true today; keep it that way (dodges ATT).

---

## 5. Verify-on-device checklist (per module, once running)
Sign in (dev or Apple), then for each: open it, create/edit/delete something, confirm it persists (and syncs across two sessions where realtime applies). Specifically: **Shopping** realtime + add/check/delete; **Pets** add pet (+photo), add event, "done/again" reminder; **Family** view + edit your profile + avatar; **Calendar** month/upcoming, add event, recurrence shows; **Money** create budget/period/entry, totals, (receipt scan if wired); **Nudges** send a preset, ack, "seen by", call; **Documents** Face ID unlock, upload a PDF/image, open, delete; **Settings** language switch, account deletion (use a throwaway account!).

---

## 6. Per-module status & known gaps

All modules type-check and are in the iOS bundle. "Gap" = not yet ported / needs device work.

| Module | Status | Known gaps to finish later |
|---|---|---|
| **Calculator** | ✅ split (even + by-item), tip/tax, better-deal, discount | By-item **photo scan** stubbed (alert); by-item people are manual entry (no household-member suggestions) |
| **Shopping** | ✅ realtime sync, per-store sections, add/check/delete (optimistic) | **Offline queue** not ported (online-only); delete is an X button (no swipe); store logos are colored monograms (no brand bitmaps) |
| **Pet Care** | ✅ carousel, profiles, events, next-due reminders, "done/again" re-log, **photo upload** | None functional; verify photo upload on device |
| **Family** | ✅ member list, profile detail, edit own profile + **avatar upload** | Avatar tap-to-zoom lightbox not ported |
| **Calendar** | ✅ month grid + Upcoming, recurrence, color-by-member, kind markers + "turns N", add/edit | **Google Calendar connect/sync stubbed** (pulled Google events still display read-only) — see §3.E |
| **Money/Budget** | ✅ budgets → periods → entries, totals, category breakdown, add/edit/delete, recurring copy-forward, **AI receipt scan** (calls the deployed Haiku endpoint) | Charts simplified to bars (no pie); delete is long-press (no swipe); verify receipt scan on device |
| **Nudges** | ✅ presets, recipient picker, AI free-text (deployed endpoint + fallback), Realtime list with ack / "seen by" / call | **Background push delivery** pending (server-side, §3.E) — in-app Realtime works now |
| **Documents** | ✅ Face ID gate (re-locks on blur), category grouping, upload / open / delete | Per-owner filter replaced by category grouping; no image downscale before upload; opens in in-app browser (no custom preview) |

**Cross-cutting done:** auth (Sign in with Apple + Google + dev), i18n (EN/ES/PT-BR), light/dark theme, **brand fonts** (Fraunces + Hanken Grotesk), Settings (language / notifications / account deletion), `delete_my_account` RPC, native push registration + `expo_push_tokens`, app icon/splash, app.json capabilities, eas.json.

**Cross-cutting gaps (most also in §3):** background push send-side (server), Sign-in-with-Apple deletion token revocation (server), Shopping offline queue, no stale-while-revalidate cache yet (screens show a brief loader on open), and the by-item calculator member suggestions.

**Verification done here:** `tsc --noEmit` clean + `expo export` (iOS Metro bundle) succeeds for the whole app. **Not done:** running it on a simulator/device — that's §1 + §5 (your side).
