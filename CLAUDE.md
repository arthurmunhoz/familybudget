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
    presets (`pings.ts`), important-date types, store monograms, and language flags.
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
public/                    Icons, manifest, family.jpg backdrop photo
  sw.js                    Service worker: push + offline app-shell cache
src/
  main.tsx                 BrowserRouter + AuthProvider + ThemeProvider
  App.tsx                  Route table; every app screen is lazy()-loaded
  index.css                Theme tokens + global CSS (READ THE COMMENTS)
  pages/                   Hub-level screens: Hub (launcher), Login, Admin
  apps/<id>/               One folder per family app:
    budget/                Budgets → Months → MonthDetail (+ EntryForm,
                           SummaryChart) — note: a "month" = one budget period
    shopping/              ShoppingList (Realtime-synced) + optional per-store
                           sections (StoreLogo, lib/stores.ts catalog)
    pets/                  PetCare (events + next-due reminders)
    docs/                  DocumentVault (storage uploads, signed URLs;
                           opt-in Face ID lock via VaultGate + biometric.ts)
    dates/                 ImportantDates (birthday/renewal countdowns)
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
  (bypasses RLS), collects pet events due/overdue + important dates at 7d/1d/
  day-of lead marks, sends via `web-push`, prunes 404/410 subscriptions.
- Env (Vercel only): `VITE_VAPID_PUBLIC_KEY` (also needed at BUILD time for the
  client), `VAPID_PRIVATE_KEY`, `CRON_SECRET` (Cron sends it as a Bearer token;
  the route rejects anything else), `SUPABASE_SERVICE_ROLE_KEY`. Generate VAPID
  pairs with `npx web-push generate-vapid-keys`.
- KNOWN v1 limits: digest text is English for all users (localize later by
  joining `user_settings.language`); single fixed send time; Hobby-plan crons
  fire once/day within ~the hour, not minute-precise.

**Pings (household one-tap pings)**: a hub app (`/pings`, registered in
`apps.ts`). The Pings page (`src/apps/pings/Pings.tsx`) has the composer:
six one-tap presets, a recipient picker, and an AI "just type it" box.
`PingsBanner` shows active (non-expired) pings live with a 👍 ack + "seen
by" names + a 📞 Call button — and is rendered on BOTH the Hub and the Pings
page. Dismissal: the SENDER gets an ✕ to hide their own banner (persisted per
device in `localStorage` `pings-dismissed:<email>`); RECIPIENTS auto-hide a
ping 30s after their own ack (derived from the ack's `created_at`, re-checked
by a 5s tick). Pieces:
- `pings` + `ping_acks` tables (migration 027), RLS by household, Realtime.
  Pings auto-expire 6h after creation (`expires_at`); banner filters on it.
- `pings.recipients text[]` (migration 028): null = whole household, else a
  list of member emails. The `pings_select` RLS makes targeted pings visible
  only to recipients + sender. `🆘 help` ALWAYS sends to everyone (forced in the
  page's `recipientsFor`).
- The Pings page lists presets one-per-line (full-width, no truncation); each
  row has a grip handle to drag-reorder (Pointer Events + pointer-capture +
  `touch-none`, so it works on the iOS PWA). The order is saved per device in
  `localStorage` (`pings-order:<email>`). The `help` row has a red border
  (`border-(--expense)`) to stand out; others use `border-transparent` to keep
  heights aligned.
- `src/lib/pings.ts` — `PING_PRESETS` (kind+emoji; human text is the i18n
  key `pings.preset.<kind>`), `sendPing(kind,emoji,msg,recipients)`,
  `sendCustomPing(text,recipients)` (AI), `ackPing`, `fetchActivePings`,
  `fetchMemberPhones` (for the Call button).
- Send flow: client INSERTs under RLS (household + sender stamped by defaults),
  then calls `api/send-ping` with the id; that function (service role) verifies
  the caller shares the household and pushes to the recipients (or all but the
  sender). It also attaches the sender's `tel` from `member_profiles` so the push
  carries a Call action. Push failures are swallowed — Realtime shows it anyway.
- `api/suggest-ping` — Claude Haiku maps free text → `{kind, emoji, message}`
  in the user's language; reuses `ANTHROPIC_API_KEY`. No new env vars.
- Call button: `public/sw.js` adds a `call` notification action + `tel:` handler.
  iOS web-push IGNORES notification action buttons, so the in-app 📞 Call button
  in `PingsBanner` (shown when the sender has a Family phone) is the reliable
  path on iPhone; the notification action only works on Android/desktop.

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
Admin. Not yet (were mid-edit by another agent): Pet Care, Documents,
Important Dates.

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
