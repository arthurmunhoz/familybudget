# One Roof — iOS App Documentation

**One Roof: Family Organizer** is a native iOS app for running a household together:
a shared calendar, shopping list, budget, pet care log, family profiles, document
vault, and quick "nudges" — all synced across the family in real time. It's built
with **Expo SDK 56 + expo-router** and reuses the same **Supabase** backend as the
One Roof PWA (same project, tables, and Row-Level Security). Premium features are
sold via **One Roof Plus** (RevenueCat in-app purchase).

- **Bundle id:** `com.oneroof.app` · **App Store name:** "One Roof: Family Organizer"
- **Code:** `family-budget/mobile/` on branch `react-native-rewrite`
- **Backend:** Supabase (Postgres + RLS + Auth + Storage + Realtime) · Vercel serverless (`api/`)

---

## 1. Architecture

| Layer | Tech |
|---|---|
| App | Expo SDK 56, expo-router (file routes in `src/app/`), React 19, TypeScript |
| Backend | Supabase — Postgres with **RLS as the security boundary**, Auth, Storage, Realtime |
| Serverless | Vercel functions in `api/` (AI scans, push fan-out, Google/Apple/RevenueCat integrations) |
| Payments | RevenueCat (`react-native-purchases`) → Apple IAP |
| AI | Anthropic Claude — **Haiku only, always** (owner rule: never Opus/pricier models) |
| Design | "Warm Hearth" theme (light/dark, follows system); Fraunces + Hanken Grotesk fonts |
| i18n | English, Spanish, Portuguese (BR) — device locale + saved preference |

**Multi-tenancy (the core invariant):** every household's data is isolated by
`household_id`; RLS enforces it in Postgres, and column defaults stamp
`household_id`/`created_by` on insert (clients never pass them). **Never rely on a
client-side filter for security.** Note: `allowed_users`, `households`, and admin
tables grant admins a cross-household read (for the Admin panel), so member lists
are sourced from `useAuth().profiles` (already household-scoped), not raw queries.

---

## 2. Modules

| Module | What it does |
|---|---|
| **Hub** | App launcher (fixed header, Settings) |
| **Calculator** | Split a bill evenly or by item (with a bill-photo scan + household-member quick-add), better-deal unit price, discount |
| **Shopping** | Realtime shared list, per-store sections, **works offline** (queues + replays on reconnect) |
| **Pet Care** | Pet profiles + photos, care events, next-due reminders, "done / again" re-log |
| **Family** | Per-member profiles, avatars (tap-to-zoom), edit your own |
| **Calendar** | Month + Upcoming, recurrence, color-by-member, birthdays/anniversaries; **Google Calendar two-way sync** |
| **Money / Budget** | Home = per-budget dashboard cards (current-period balance, received/spent bars, upcoming projection, quick-add via `?add=1`); period history behind the card's period pill → entries, totals + category breakdown, recurring copy-forward, **AI receipt scan**. Amount-first entry form: live auto-suggested category chips, household **custom categories** (`custom_categories`, migration 042), Today/Yesterday date chips |
| **Nudges** | One-tap household pings + AI free-text, realtime list with ack / "seen by" / call |
| **Documents** | Face ID-gated vault, category grouping, upload / open / delete |
| **Settings** | Language, appearance, notifications, One Roof Plus, account (sign out, delete) |
| **Admin** (admin-only) | Usage analytics (per-app views/time, recent errors) + household/member management, via admin-guarded RPCs |

---

## 3. Key systems

- **Auth** (`src/lib/auth.tsx`): Sign in with Apple (`signInWithIdToken`), Google
  OAuth (in-app `WebBrowser`), and a DEV-only email/password login. In-app account
  deletion (`delete_my_account` RPC) also revokes the Apple token
  (`api/apple-connect` / `api/apple-revoke`).
- **One Roof Plus** (`src/lib/plus.tsx`, `src/app/paywall.tsx`): entitlement is
  **per household** — RevenueCat's `app_user_id` is the `household_id`, so any
  member's purchase covers the family. `usePlus().isPlus` OR's the RevenueCat
  entitlement with the server plan (`household_subscriptions`, stamped by
  `api/revenuecat-webhook`). Generous-free gates route to `/paywall`: the Document
  Vault Face ID lock (uploads/viewing are free), Google + Apple Calendar connect,
  the by-item bill split, a 2nd+ budget, and the AI-scan cap.
  **Revocation on lapse:** the server plan guards on `expires_at`, so a
  cancelled/expired subscription auto-downgrades. `PlusProvider` re-checks the
  entitlement on every app foreground (`AppState` → `refresh()`) so features lock
  promptly, and the stateful features that keep running once enabled — calendar
  sync — re-check Plus at sync time (Google server-side in
  `api/google-calendar-sync`, Apple on-device in `syncAppleCalendar`). Existing
  budgets stay usable after a lapse (only creating new ones is blocked).
- **AI scans** (`api/scan-receipt`, `api/scan-bill`): **Claude Haiku only** — an
  unreadable photo fails with "try a clearer photo"; never escalate to Opus or
  any pricier model (owner rule, applies to every AI call in the app).
  Per-household metering + a global daily-spend kill-switch (`ai_scan_allowed`),
  **unlimited for Plus**.
- **Push** (`api/send-ping`, `api/send-digest`): Expo push tokens + web-push,
  per-recipient language.
- **Home-Screen Widgets** (`targets/widgets/`, `src/lib/widget.ts`): a WidgetKit
  extension (Budget + Nudges) fed through an App Group
  (`group.com.oneroof.app`, `@bacons/apple-targets`'s `ExtensionStorage`) since
  the widget process can't reach the app's JS/Supabase session.
  `useSyncNudgeWidget` (mounted in `_layout.tsx`) pushes the send token,
  household members, real editable presets, and the app's own Light/Dark
  choice on every login — not gated on visiting the Nudges screen. Tapping a
  preset sends via `api/widget-nudge.ts` (a per-device token, not a Supabase
  session) and flashes a "sent!" confirmation using WidgetKit's own timeline
  mechanism (two dated entries; iOS itself flips between them, no process
  needed at the transition). The confirmation is instant because
  `SendNudgeIntent` does NOT await the POST — iOS only re-renders a widget after
  the intent's `perform()` returns, so an awaited (cold-start) network call
  would freeze the old list on screen for seconds. The POST is handed to
  `NudgeSender`, a **background `URLSession`** (`sharedContainerIdentifier` =
  App Group, file-based upload) that the system daemon completes even after the
  extension suspends, so `perform()` can return immediately. Acking a nudge (`api/ack-ping.ts`) sends a
  **silent** push back to the sender so their widget can show "seen by" —
  caught by `src/lib/backgroundNotifications.ts`
  (`UIBackgroundModes: remote-notification` + `expo-task-manager`),
  best-effort like every other push here (no background delivery if the app
  was force-quit). Widget text is English-only for now — SwiftUI widgets don't
  share the app's `t()` dictionaries.
- **Offline** (`src/lib/offline.ts`): AsyncStorage outbox for the shopping list.
- **Caching** (`src/hooks/useCachedQuery.ts`): stale-while-revalidate so screens
  render instantly on return (cleared on sign-out).

**Verification gate (no simulator in CI/agent):** `npx tsc --noEmit` **and**
`npx expo export --platform ios` must both pass before commit. On-device behavior
(auth, camera, Face ID, push, IAP) must be checked by a human on a device.

---

## 4. Build, run & release

```bash
cd family-budget/mobile
npx expo start                         # dev — tap "Dev sign in" (needs .env.local)
eas build -p ios --profile preview     # standalone build for a device
eas submit -p ios                      # submit to App Store Connect
```
Server (PWA + `api/`) deploys manually: `npx vercel deploy --prod` (production
domain `one-roof-app.vercel.app`). RevenueCat/IAP and Google/Apple OAuth only work
in a real build on a device, not Expo Go.

### Environment variables

| Where | Vars |
|---|---|
| **App** (`eas.json` env / `.env.local`) | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_API_BASE`, `EXPO_PUBLIC_REVENUECAT_IOS_KEY` (+ dev-only `EXPO_PUBLIC_DEV_EMAIL`/`_PASSWORD`) |
| **Vercel** (server) | `ANTHROPIC_API_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_CLIENT_ID`, `APPLE_PRIVATE_KEY`, `REVENUECAT_WEBHOOK_SECRET` |

Secrets live only in Vercel / EAS env — never commit them. The `EXPO_PUBLIC_*`
Supabase anon and RevenueCat keys are publishable and safe to embed in the app.

---

## 5. What's left to do now

Everything else — the app, Sign in with Apple + account deletion, native push,
privacy/support pages, Google Calendar connect code, and the full One Roof Plus
implementation — is **built and deployed**. These are the remaining owner-only
tasks, all requiring accounts/secrets or a device.

### A. One Roof Plus — RevenueCat & App Store Connect (to start selling)
1. **Paid Applications Agreement** — App Store Connect → Agreements, Tax & Banking.
2. **Create the IAP products** — a subscription group with **Monthly $4.99**,
   **Yearly $39.99** (+ 7-day free intro offer), optional **Lifetime $79.99**.
3. **RevenueCat** — project + iOS app (`com.oneroof.app`); an **Entitlement with
   identifier exactly `plus`** ⚠️ (must match the code); attach the products;
   build the current **Offering**; copy the **iOS SDK key**.
4. **EAS env** — set `EXPO_PUBLIC_REVENUECAT_IOS_KEY`, then rebuild.
5. **Webhook** — RevenueCat → Webhooks → `https://one-roof-app.vercel.app/api/revenuecat-webhook`,
   Authorization header = a strong secret; set `REVENUECAT_WEBHOOK_SECRET` in
   Vercel and `vercel deploy --prod`.
6. **Sandbox-test** on a device: subscribe → Plus unlocks; test **Restore**;
   confirm a `household_subscriptions` row appears.
7. **Launch lever** — once purchasable, lower the free scan cap so Plus has value:
   `update public.ai_config set free_monthly_cap = 15;` (currently 100; your own
   household is comped to Plus).

### B. Google Calendar connect (to make it functional)
Enable/allow the **`calendar.events` scope** on your Google OAuth consent screen
(Google Cloud Console — the same project the Supabase Google provider uses). The
`oneroof://auth-callback` redirect is already in Supabase. Then test Connect on a
device.

### C. App Store submission
- **Privacy Nutrition Labels** — declare Contact Info, User Content
  (receipts/vault/pet photos), Financial Info, Identifiers, and **disclose that
  receipt/bill images are sent to Anthropic**. Set "Data Not Used to Track You"
  (no ad/tracking SDKs → no ATT prompt).
- **Screenshots** (6.7" required) + **review notes**: include the demo account,
  the Anthropic disclosure, and that account deletion is in Settings. First
  submission must include the IAP for review.
- Category **Lifestyle**, age rating **4+**.

### D. On-device QA
Do a pass on a real device for the features that can't be verified without one:
Sign in with Apple, camera scans (receipt + bill), Face ID vault, push delivery,
offline shopping (airplane-mode add/check → reconnect), Google Calendar connect,
and the Plus purchase/restore flow.

### E. Home-Screen Widgets — ship the native + server changes
Verified in Simulator only so far (real APNs delivery/latency can't be tested
there — `xcrun simctl push` fakes the payload arriving but not real-world
timing or reliability). Before this reaches a real device:
1. **Deploy the server side** — `api/widget-nudge.ts` (updated) and
   `api/ack-ping.ts` (new) aren't live yet: `npx vercel deploy --prod`.
2. **New EAS build required** — the widget's theme/preset/confirmation logic,
   the new `UIBackgroundModes: remote-notification` entitlement, and the
   `expo-task-manager` dependency are all native changes; no build on the App
   Store or a device has them until the next `eas build -p ios`.
3. **Real-device QA** — confirm the "seen by" ack push actually arrives
   (latency, and that it's silent/no visible banner), and reconfirm it
   legitimately doesn't fire when the app's been force-quit (expected, not a
   bug — iOS gives zero background execution to force-quit apps).

---

## 6. Next improvements (backlog)

Non-blocking polish, roughly by value:

- **Localization** — the paywall and a few Settings strings are English-only;
  localize into ES/PT to match the rest. Localize the daily digest email too.
- **Shopping** — swipe-to-delete (currently an X button); real brand store logos
  (currently colored monograms).
- **Documents** — a custom in-app preview (currently opens the system browser).
- **Money** — a category pie/donut (category breakdown is bars today; the
  received-vs-spent donut exists); swipe-to-delete entries.
- **Calendar** — sync secondary/shared Google calendars (only `primary` today);
  add a Vercel cron for background Google sync (currently on-open + after-edit).
- **Push** — prune stale Expo push tokens from send receipts.
- **App icon** — replace the upscaled icon with a crisp 1024×1024 PNG.
- **Widgets** — localize widget text (ES/PT — currently English-only, see §3);
  extend the Warm Hearth theme sync + real-data treatment from the Nudges
  widget to the Budget widget (still system-appearance-only, POC-level).

---

## 7. Related docs

- `mobile/CLAUDE.md` — conventions & guardrails for developers/agents.
- `mobile/APP-STORE-LISTING.md` — store copy, keywords, screenshot plan, review notes.
- `../CLAUDE.md` — the PWA/backend guide (shared Supabase schema, RLS, `api/`).
- `../supabase/schema.sql` + `migration-NNN-*.sql` — the database, in order.
