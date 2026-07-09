# One Roof — guide for developer agents

Multi-household family PWA (budget, shopping list, pet care, document vault,
important dates, family profiles) at https://one-roof-app.vercel.app. React SPA
+ Supabase; RLS in Postgres is the real security boundary. This file tells you
where things are, how to make changes safely, and which mistakes have already
been made so you don't repeat them.

**Keep this file current.** After any change that alters structure, workflows,
conventions, or gotchas, update the relevant section here in the same task —
this doc is the contract for every agent that follows you.

## Tech stack

- **Vite + React 19 + TypeScript**, `react-router-dom`, Recharts (charts)
- **Tailwind CSS v4** — note the v4 arbitrary-value syntax used everywhere:
  `bg-(--card)`, `text-(--text-muted)`. Tokens are CSS variables defined in
  `src/index.css` and flipped by `:root[data-theme='light'|'dark']`.
- **Design system — "Warm Hearth"** (full refresh, 2026-06): warm clay/terracotta
  brand on warm-paper neutrals. Light theme is "Paper", dark is "Dusk" (warm
  espresso, never cold gray) — both defined as the same token names in
  `index.css`, so screens need no theme-specific code. `--accent` is clay.
  - **Type**: Fraunces (display serif) + Hanken Grotesk (UI sans), self-hosted
    via `@fontsource-variable/*` (imported in `main.tsx`). `--font-sans` is the
    body default; add the `.font-display` class to screen titles, greetings, and
    hero numbers to get the serif. `src/fonts.d.ts` declares the side-effect imports.
  - **Icons**: one cohesive outline set from `lucide-react`. Hub/app icons live
    in `apps.ts` as `LucideIcon` components (`HubApp.icon`), rendered `<app.icon/>`.
    Chrome must use Lucide, NOT emoji. Emoji are kept ONLY as *content* markers:
    budget categories (`categories.ts`), pet species (`pets/petMeta.ts`), ping
    presets (`pings.ts`), calendar event kinds, store monograms, and language flags.
  - App tile display names are localized via `app.<id>.name` (e.g. Budget→"Money",
    Pings→"Nudges", Document Vault→"Documents"); the `pings` slug/route/tables stay
    internal — only the display label changed to Nudges.
- **Supabase**: Postgres + RLS, Google OAuth, Storage (documents), Realtime
  (shopping list). Client in `src/lib/supabase.ts`, env via `VITE_SUPABASE_*`.
- **Vercel**: static build + serverless functions in `api/` — `scan-receipt.ts`
  (Claude vision; `ANTHROPIC_API_KEY`, verifies the caller's Supabase JWT) and
  `send-digest.ts` (daily push digest cron, see Push notifications below).
- PWA: `public/manifest.webmanifest`, apple-touch meta in `index.html`. Brand
  is "One Roof"; icons are `public/roof-icon-*.png`. `public/sw.js` (registered
  in `main.tsx`) handles push AND offline app-shell caching — but
  CONSERVATIVELY: navigations are network-first (a deploy always wins online),
  hashed `/assets/*` are cache-first (content-fingerprinted, safe forever),
  cross-origin (Supabase) is never touched, and on `localhost` the fetch handler
  is a no-op so dev/HMR is unaffected. Bump `CACHE` in `sw.js` to hard-reset.

## File map

```
api/scan-receipt.ts        Receipt photo → structured entry (Claude vision)
api/scan-bill.ts           Itemized bill photo → line items + tax/tip (Claude vision)
api/send-digest.ts         Daily Vercel-Cron push digest (pets + dates)
api/send-ping.ts         Push a household ping to everyone but the sender
api/suggest-ping.ts      Free text → {kind,emoji,message} ping (Claude)
api/google-calendar-connect.ts  Store a user's Google OAuth tokens (service role)
api/google-calendar-sync.ts     Pull Google Calendar events → calendar_events
public/                    Icons, manifest, family.jpg backdrop photo
  sw.js                    Service worker: push + offline app-shell cache
src/
  main.tsx                 BrowserRouter + AuthProvider + ThemeProvider
  App.tsx                  Route table; every app screen is lazy()-loaded
  index.css                Theme tokens + global CSS (READ THE COMMENTS)
  pages/                   Hub-level screens: Hub (launcher), Login, Admin
  apps/<id>/               One folder per family app:
    budget/                Budgets (home: per-budget dashboard cards — current
                           period balance/bars + "New entry" → /month/:id?add=1
                           which auto-opens the form) → Months (period history,
                           reached from the card's period pill) → MonthDetail
                           (+ EntryForm, SummaryChart). EntryForm is amount-first
                           with category chips + an "All" grid that can create
                           household custom_categories (migration 042; entries
                           store the uuid as text — always resolve icons/names
                           via categoryById(id, customCats)). A "month" = one
                           budget period (month/week/day per budgets.period).
    shopping/              ShoppingList (Realtime-synced) + optional per-store
                           sections (StoreLogo, lib/stores.ts catalog)
    pets/                  PetCare (events + next-due reminders)
    docs/                  DocumentVault (storage uploads, signed URLs;
                           opt-in Face ID lock via VaultGate + biometric.ts)
    calendar/              Calendar (month + Upcoming; calendar_events; dates + Google sync)
    family/                Family (per-member profiles + avatars)
    calc/                  Calculator (Split a bill evenly/by-item via photo
                           scan, Better deal unit-price, Discount) — no DB
  components/              Shared: Backdrop, Drawer, AnalyticsTracker,
                           ErrorBoundary, VaultGate, NotificationsToggle,
                           PingsBanner, NotificationsNudge
  hooks/                   useAuth, useBack, useTheme, useI18n, useHousehold,
                           useAppPrefs, useScrollLock
  lib/                     apps.ts (hub registry), types.ts, format.ts,
                           categories.ts, analytics.ts, biometric.ts,
                           push.ts (web-push opt-in), pings.ts (household
                           pings), i18n/ (en|es|pt dicts), image.ts,
                           signedUrls.ts, supabase.ts
supabase/
  schema.sql               Original bootstrap — NOT standalone; see its footer
  migration-NNN-*.sql      One file per applied migration, in order
```

## How to do things

**Add a hub app**: folder under `src/apps/<id>/`, entry in `APPS` in
`src/lib/apps.ts`, lazy route in `App.tsx`. Copy the structure of
`shopping/ShoppingList.tsx` — header with `useBack`, `min-h-dvh` page,
fixed bottom action bar with `env(safe-area-inset-bottom)` padding.

**Change the database**: write a migration and apply it (via the Supabase
MCP `apply_migration` when available), then mirror the exact SQL into
`supabase/migration-NNN-<name>.sql` and append the file to the ordered list
at the bottom of `schema.sql`. Never edit applied migration files; add a new
one.

**Multi-tenancy rules (the core invariant)**:
- Every top-level table has `household_id uuid not null default
  public.current_household()` — clients DON'T pass it; the default stamps it.
- RLS: top-level tables check `household_id = public.current_household()`;
  child tables (months/entries via budgets, pet_events via pets) check
  through their parent with an `exists` subquery.
- `public.current_household()` and `public.is_admin()` are `security definer`
  (avoids RLS recursion). Legacy `public.is_allowed()` still exists but new
  policies shouldn't use it.
- Storage objects live under `<household_id>/...` and the bucket policy
  enforces that prefix — always build paths as
  `${profile.household_id}/<category>/<uuid>.<ext>`.
- Admin-only aggregates are `security definer` functions guarded by
  `where public.is_admin()` (see `admin_user_activity`).
- **`is_admin` is a GLOBAL super-admin, NOT a per-household role** — the admin
  RLS policies aren't household-scoped, so `is_admin=true` can read/write EVERY
  household. Household "ownership" is a separate, household-scoped
  `allowed_users.role` (`owner`/`member`, migration 051). NEVER give a normal
  user `is_admin`; onboarding/owner flows use `role='owner'`.
- **Self-serve onboarding (migration 051)**: open signup — a first-login user
  with no `allowed_users` row can `create_household(name)` (becomes `owner`,
  `is_admin=false`) or `join_household(code)` (becomes `member`). Codes live in
  `household_join_codes` (RLS-locked, definer-only; every household gets one via
  an AFTER INSERT trigger). Owner-only RPCs: `get_join_code()`,
  `rotate_join_code()`, `remove_member(email)`. All are `security definer`,
  guarded on `jwt_email()` + a "not already in a household" check — clients call
  the RPCs, never write `allowed_users`/`households`/`household_join_codes`
  directly (admin-only RLS is unchanged). Client onboarding UI is iOS-first
  (PWA parity in the backlog).

**Auth/profile**: `useAuth()` gives `profile` (self) and `profiles` (members
of OWN household only — already filtered; admins can query `allowed_users`
directly for cross-household needs, see `Admin.tsx`).

**Back navigation**: back buttons must POP history, not push. Always
`const back = useBack()` then `back('/fallback-parent')`. Never
`navigate('/parent')` for a back action — it creates an endless history trail.

**Analytics**: `AnalyticsTracker` (mounted in `App.tsx`) already captures
page views and button clicks globally — new features need no instrumentation.
For custom events use `track(type, fields)` from `src/lib/analytics.ts`.
Analytics code must never throw into the app.

**Push notifications (daily digest)**: opt-in web push, delivered as one
morning notification per household. Pieces:
- `public/sw.js` — push-only service worker (shows notification, focuses/opens
  the app on tap). Registered in `main.tsx`.
- `src/lib/push.ts` — browser side: `pushState()` (returns `unsupported` /
  `needs-install` / `default` / `granted` / `denied`), `enablePush()` /
  `disablePush()`. iOS only allows push for the **installed Home-Screen PWA**
  (16.4+) — `pushState()` returns `needs-install` in a plain Safari tab.
- `src/components/NotificationsToggle.tsx` — the Drawer "🔔 Reminders" control.
- `push_subscriptions` table (migration 026) — one row per device; RLS so users
  manage only their own. `user_email` + `household_id` are stamped by column
  defaults (don't pass them from the client).
- `api/send-digest.ts` — Vercel **Cron** target (`vercel.json` → daily 11:00
  UTC ≈ 8am BRT / 7am ET). Reads every household with the **service role**
  (bypasses RLS), collects pet events due/overdue + calendar special dates
  (birthdays/anniversaries/renewals) at 7d/1d/day-of lead marks + plain events
  with a reminder due today, sends via `web-push`, prunes 404/410 subscriptions.
- Env (Vercel only): `VITE_VAPID_PUBLIC_KEY` (also needed at BUILD time for the
  client), `VAPID_PRIVATE_KEY`, `CRON_SECRET` (Cron sends it as a Bearer token;
  the route rejects anything else), `SUPABASE_SERVICE_ROLE_KEY`. Generate VAPID
  pairs with `npx web-push generate-vapid-keys`.
- KNOWN v1 limits: digest text is English for all users (localize later by
  joining `user_settings.language`); single fixed send time; Hobby-plan crons
  fire once/day within ~the hour, not minute-precise.

**Pings (household one-tap pings, aka "Nudges")**: a hub app (`/pings`,
registered in `apps.ts`). The Pings page (`src/apps/pings/Pings.tsx`) has the
composer: an editable per-household list of one-tap presets, a recipient
picker, and an AI "just type it" box. `PingsBanner` shows BOTH active
(non-expired) pings sent TO me (with a 👍 Got it + 📞 Call CTA) AND pings I
SENT (with "seen by" ack status + an ✕ dismiss) — rendered on BOTH the Hub and
the Pings page. Dismissal: the SENDER's ✕ hides their own sent-row (persisted
per device in `localStorage` `pings-dismissed:<email>`); RECIPIENTS' rows drop
off the moment they ack (optimistic + Realtime).
- `pings` + `ping_acks` tables (migration 027), RLS by household, Realtime.
  Pings auto-expire 6h after creation (`expires_at`); banner filters on it.
  `pings.high_priority boolean` (shared schema with iOS) replaces the old
  hardcoded `kind === 'help'` special-casing — ANY preset can be flagged
  high-priority now, which drives red UI, a Call CTA, forced send-to-everyone,
  and an urgent push.
- `pings.recipients text[]` (migration 028): null = whole household, else a
  list of member emails. The `pings_select` RLS makes targeted pings visible
  only to recipients + sender. A `high_priority` ping ALWAYS sends to everyone
  (forced in `sendPing`, ignoring any recipient-picker selection).
- `ping_presets` table: per-household editable presets (`emoji`, `label`,
  `preset_key`, `high_priority`, `sort_order`). Seeded on first read via the
  Postgres function `seed_ping_presets()` (called defensively — no-ops once a
  household has rows). `label` null + `preset_key` set = a seeded default,
  localized via `pings.preset.<preset_key>`; editing a preset clears
  `preset_key` and sets a custom `label` (`presetText()` in `pings.ts` picks
  whichever is set). The Pings page has an "Edit presets" toggle that flips
  the list into a manage mode: tap a preset to edit emoji/label/high-priority,
  a delete ✕ per row, and an "Add nudge" row to create new ones — all direct
  Supabase read/writes (RLS-scoped to the household).
- `src/lib/pings.ts` — `fetchPingPresets` (seeds + fetches, ordered by
  `sort_order`), `createPingPreset`/`updatePingPreset`/`deletePingPreset`,
  `presetText(preset, t)`, `sendPing(kind,emoji,msg,recipients,highPriority)`,
  `sendCustomPing(text,recipients)` (AI — always `high_priority: false`),
  `ackPing`, `fetchActivePings`, `fetchMemberPhones` (for the Call button).
  Kept in sync with `mobile/src/lib/pings.ts` (the iOS Nudges feature this was
  ported from) — same table/RPC contract, same preset semantics.
- Send flow: client INSERTs under RLS (household + sender stamped by defaults),
  then calls `api/send-ping` with the id; that function (service role) verifies
  the caller shares the household and pushes to the recipients (or all but the
  sender). It also attaches the sender's `tel` from `member_profiles` so the push
  carries a Call action, and marks the push `urgent` when `high_priority` is
  true. Push failures are swallowed — Realtime shows it anyway.
- `api/suggest-ping` — Claude Haiku maps free text → `{kind, emoji, message}`
  in the user's language; reuses `ANTHROPIC_API_KEY`. No new env vars. The AI
  path never sets `high_priority` — that flag is only ever set explicitly via
  a preset's toggle.
- Call button: `public/sw.js` adds a `call` notification action + `tel:` handler.
  iOS web-push IGNORES notification action buttons, so the in-app 📞 Call button
  in `PingsBanner` (shown when the sender has a Family phone) is the reliable
  path on iPhone; the notification action only works on Android/desktop.
  High-priority pings show Call AND Got it together (not either/or) so a
  recipient can acknowledge without having to call.

**Data fetching — cache to avoid the "blink"**: screens re-mount on every
navigation, so fetching from empty state flashes (0 → real value). Use
`useCachedQuery(key, fetcher)` (`src/hooks/useCachedQuery.ts`) — stale-while-
revalidate over an in-memory cache: it returns the last value instantly,
refetches in the background, and only re-renders if the data changed. Combine
multiple queries into one object per screen (one cache key); call the returned
`revalidate()` after a mutation instead of a manual `load()`. For screens with
their own optimistic/Realtime local state (e.g. ShoppingList), keep that state
but seed it from `readCache(key)` and write through with `writeCache(key, …)`.
Already cached: Hub badges, Budgets, Months, MonthDetail, Family, ShoppingList,
Admin. Not yet (were mid-edit by another agent): Pet Care, Documents.

**Shared Calendar (`/calendar`)**: a hub app (`apps/calendar/Calendar.tsx`) and the
single date surface — it absorbed the old Important Dates feature (migration 038
copied those rows in; the `important_dates` table is dormant, drop later). A
**Month / Upcoming** toggle: Month is a grid + per-day agenda; Upcoming is the
"what's coming up" countdown list. Over `calendar_events` (migration 035): all-day
OR timed, multi-day spans, recurrence (none/daily/weekly/monthly/yearly),
color-by-member, reminders, and a `kind` (event/birthday/anniversary/renewal/other)
— special kinds show a 🎂/💍/📋/📌 marker and birthday/anniversary "turns N" age,
and default to all-day + yearly + household-owned. `src/lib/calendar.ts` holds
`KIND_EMOJI`, the color palette + `eventColor`/`memberColor`, recurrence expansion
(`occurrencesByDay`, `upcomingOccurrences`), `yearsAt`, `formatTime`. Events default
`owner_email` to the creator; `null` = whole household (clay). Household-scoped RLS;
`household_id`/`created_by` auto-stamped by column defaults.

**Google Calendar sync** (two-way):
- `google_calendar_connections` (migration 036) — one row per user who links
  Google. OAuth tokens are written ONLY by the service role; column grants hide
  `access_token`/`refresh_token` from clients (the app selects status columns
  only). RLS: own-row select/delete.
- Connect flow: `src/lib/googleCalendar.ts` `connectGoogleCalendar()` re-runs
  Google OAuth with the `calendar.events` scope (`access_type=offline` +
  `prompt=consent`) → redirect to `/calendar`. `useAuth`'s `onAuthStateChange`
  calls `handleConnectRedirect(session)`, which POSTs the one-time
  `provider_refresh_token` to `api/google-calendar-connect.ts` (the client can't
  persist it — RLS denies), then triggers a sync.
- Calendar sync is a **One Roof Plus** feature and is enforced **server-side**:
  `api/google-calendar-sync.ts` skips any connection whose household isn't Plus
  (via the `household_is_plus(p_household)` RPC, which guards on the
  subscription's `expires_at`), so a lapsed/cancelled plan stops syncing
  automatically — no disconnect needed, and a stale client can't bypass it. The
  Apple equivalent (`mobile/src/lib/appleCalendar.ts` `syncAppleCalendar`) runs
  on-device, so it self-gates with the session-scoped `current_household_is_plus`
  RPC (fail-open only on a network error, never on an explicit `false`).
- `api/google-calendar-sync.ts` — refreshes the access token (needs
  `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` env), pulls events in a -30d..+180d
  window (`singleEvents=true`), upserts into `calendar_events` (source='google',
  `owner_email` = the connecting user so they show in that member's color),
  prunes events removed from Google within the window. Callable by Vercel Cron
  (`CRON_SECRET`) or a signed-in user (JWT — the "Sync now" button). The Calendar
  screen also auto-syncs on open if the last sync is >10 min old.
- Push (One Roof → Google): the same function first pushes events the connecting
  user created (`source='oneroof'`, `created_by` = user) — `events.insert` for new,
  `events.patch` when `updated_at > synced_at`, and deletes anything tombstoned in
  `calendar_deletions` (migration 037). Timed events push with the calendar's
  `time_zone`; simple recurrence → RRULE. Our own pushed events (and recurring
  instances, matched via `recurringEventId`) are skipped on pull so they don't
  re-import as duplicates. The client kicks a sync right after a save/delete when
  connected; `calendar_events.updated_at` is bumped by the client on every edit.
- Env (Vercel only): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (same as the
  Supabase Google provider). Supabase Auth → URL Configuration → Redirect URLs
  must include the app origin with `/**` so the `/calendar` redirect is allowed.
- KNOWN v1 limits: only the `primary` Google calendar (no secondary/shared
  calendars yet); pulled recurring events arrive as expanded instances; `UNTIL`
  on pushed recurrence is date-granular; no Vercel cron yet (freshness via
  on-open auto-sync + sync-after-edit + manual "Sync now").

**Offline (`src/lib/offline.ts`)**: the shopping list works with no connection.
`loadLocal`/`saveLocal` are durable (localStorage) JSON helpers; the shopping
list seeds from and writes through to them so it renders offline. Mutations are
offline-first: update local state → `enqueueOp(...)` → `void load()`. `load()`
no-ops when `!navigator.onLine` (keeps the persisted list, never wipes it on a
failed fetch) and otherwise flushes the outbox before refetching.
`flushShoppingOutbox()` replays queued ops in order, remapping `tmp-…` ids to
real ids as inserts land (so a toggle of an offline-added item still resolves);
it runs on each mutation, on the `online` event, and on mount. To extend
offline to another feature, follow the same outbox shape.

**Images (avatars, pet photos, backdrop, docs)**: all live in the private
`documents` bucket and are served via signed URLs. ALWAYS resolve them through
`src/lib/signedUrls.ts` (`getSignedUrl` / `getSignedUrls`) — never call
`createSignedUrl(s)` directly. The helper caches URLs in memory and mints 24h
tokens, so repeat views skip the round-trip AND get browser-cache hits (a fresh
token each load = a new URL = a forced re-download). Resize photos before upload
with `fileToResizedBase64` (avatars/pets 512px, backdrop 1800px, doc images
2048px) and pass `cacheControl: '604800'` to `.upload()` — paths are
content-addressed (uuid per upload) so long caching is safe.

**Money/date helpers**: use `src/lib/format.ts` (`formatMoney`, `formatDay`,
`todayISO`, period helpers). Dates are ISO `YYYY-MM-DD` strings end-to-end;
compare them lexicographically, don't construct `Date` objects for that.

## Verifying changes locally (including behind-auth screens)

Use the Claude `preview` MCP (it runs the dev server, port 5173) — not raw
`npm run dev` in Bash. Workflow: `preview_start` → drive the page → `preview_snapshot`
(accessibility tree, best for asserting structure/text) and `preview_screenshot`
(visual). Reload with `preview_eval` (`window.location.href=…`).

Most screens sit behind Google sign-in, which the headless preview browser can't
complete. To get in:
- The Login screen has a DEV-only **🔧 Dev login** button (compiled out of prod
  via `import.meta.env.DEV`) that signs in with `VITE_DEV_EMAIL` /
  `VITE_DEV_PASSWORD` from `.env.local` — a seeded test household (Alex & Sam
  Rivera with sample budget/pets/docs/family data). Click it, or the Supabase
  session may already persist; then navigate to the route you changed.
- New `.env.local` vars require a dev-server restart to load.
- ALWAYS verify behind-auth UI this way before claiming it works. Do NOT build
  throwaway mock-harness components for it (the old approach — no longer needed).
- `preview_screenshot` is a Chromium render. iOS-specific behavior (Face ID /
  WebAuthn, native `input[type=date]` sizing, standalone PWA layout) still needs
  a real-device check — say so rather than implying you verified it.
- Production (one-roof-app.vercel.app) only reflects committed + DEPLOYED code;
  if someone "doesn't see" a committed change there, it just isn't deployed yet.

## Coding standards

**Match the established pattern — don't invent a new one.** Before writing a
new session/data-fetching flow, grep for how the existing code in the same
area already does it (`src/hooks/useAuth.tsx`, `src/lib/googleCalendar.ts` are
the reference implementations for anything session/auth-related) and follow
that, even if a different approach would also technically work. A one-off
pattern that diverges from the rest of the codebase is how subtle,
hard-to-reproduce bugs get introduced — see the `mobile/CLAUDE.md` "Coding
standards" section for two real examples (a `getUser()` vs `getSession()` auth
bug, and a component-defined-inside-a-component focus bug) whose lessons apply
here too:
- **Reading the current user/session: always `supabase.auth.getSession()`,
  never `supabase.auth.getUser()`.** `getSession()` reads the cached local
  session (instant, no network). `getUser()` round-trips to the Auth server to
  revalidate the JWT — on any network hiccup it resolves with `user: null`
  instead of throwing, silently masquerading as "not signed in" deep inside an
  unrelated flow.
- **Never define a component inside another component's render body.** It
  gets a new function identity on every render of the parent, so React
  unmounts + remounts it on every state change — dropping focus from any
  `<input>` inside it. Hoist sub-components above the parent, passing data in
  as props. A plain function that *returns* JSX and is called directly
  (`{card('A', ...)}`, not `<Card/>`) is fine — it doesn't create a new
  component type, just inlines the tree. (This is exactly why `BetterDeal`'s
  `card()` helper in `Calculator.tsx` is written as a closure call, not a
  `<Card/>` component — keep it that way if you touch it.)
- **Before shipping a fix for a reported bug, verify the actual root cause**
  against the DB (migrations, RLS, constraints — via the Supabase MCP tools)
  and the client code path, not just the symptom. A generic error message can
  come from several unrelated causes — confirm which one before touching code.

## How NOT to do things (learned the hard way)

- **iOS standalone PWA layout** — this app is used as an installed PWA on
  iPhone, where layout bugs don't reproduce in desktop browsers:
  - Page background goes on `html` ONLY. A background on `body` paints over
    `fixed` elements with negative z-index (kills the backdrop).
  - NEVER lock the body (`overflow: hidden`) and scroll an inner container —
    it creates dead bands at the bottom in standalone mode. Keep natural body
    scrolling; safe-area padding lives on `body`; pages are `min-h-dvh`;
    bottom bars are `fixed bottom-0` with `env(safe-area-inset-bottom)`
    padding. Two CSS attempts to "fix" perceived gaps made things worse —
    don't re-litigate this without testing on a real device.
  - Inputs need `font-size: 16px` minimum or iOS zooms the viewport on focus.
  - `input[type=date]` needs the flex centering fix in `index.css`.
- **NEVER rename/move storage files via SQL** (`update storage.objects set
  name = ...`). The file bytes live in S3 under keys tied to the original
  path; a SQL rename only changes metadata, leaving pointers at locations
  with no bytes — uploads/list keep working but every download 400s. Use the
  Storage `move()` API (service role via an edge function for bulk moves —
  see the `fix-doc-paths` function, which repaired exactly this incident on
  2026-06-12).
- **Don't trust the client for tenancy** — never rely on a `.eq('household_id',
  ...)` filter for security; RLS does that. Client filters are for UX only.
- **The `months` table is misleadingly named** — a row is one budget *period*
  (month, week, or day depending on `budgets.period`). Don't assume monthly.
- **Don't break analytics privacy**: members must never gain `select` on
  `web_events`; only admins read it.
- **Secrets**: never commit keys. `ANTHROPIC_API_KEY` and `VITE_SUPABASE_*`
  live in Vercel env vars only.

## Build, deploy, git

- `npm run build` runs `tsc -b && vite build` — this is the only gate (no
  test suite). Run it before every commit.
- Deploys are MANUAL: `npx vercel deploy --prod --yes`. Pushing to GitHub
  does NOT deploy. Production domain: one-roof-app.vercel.app.
- Commit messages: plain, descriptive, no Co-Authored-By/AI trailers.
- This repo pushes with a repo-local git identity + SSH key (already
  configured via `core.sshCommand`); don't change global git config.
- Working interactively with Arthur? Present the change (screenshot, copy,
  rendered image) and get his OK before committing/deploying non-trivial
  work.
