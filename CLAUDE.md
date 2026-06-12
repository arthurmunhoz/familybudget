# One Roof — guide for developer agents

Multi-household family PWA (budget, shopping, pets, documents) at
https://one-roof-app.vercel.app. React SPA + Supabase; RLS in Postgres is the
real security boundary. This file tells you where things are, how to make
changes safely, and which mistakes have already been made so you don't repeat
them.

## Tech stack

- **Vite + React 19 + TypeScript**, `react-router-dom`, Recharts (charts)
- **Tailwind CSS v4** — note the v4 arbitrary-value syntax used everywhere:
  `bg-(--card)`, `text-(--text-muted)`. Tokens are CSS variables defined in
  `src/index.css` and flipped by `:root[data-theme='light'|'dark']`.
- **Supabase**: Postgres + RLS, Google OAuth, Storage (documents), Realtime
  (shopping list). Client in `src/lib/supabase.ts`, env via `VITE_SUPABASE_*`.
- **Vercel**: static build + one serverless function (`api/scan-receipt.ts`,
  Claude vision; uses `ANTHROPIC_API_KEY` env var, verifies the caller's
  Supabase JWT before spending credits).
- PWA: `public/manifest.webmanifest`, apple-touch meta in `index.html`. Brand
  is "One Roof"; icons are `public/roof-icon-*.png`.

## File map

```
api/scan-receipt.ts        Receipt photo → structured entry (Claude vision)
public/                    Icons, manifest, family.jpg backdrop photo
src/
  main.tsx                 BrowserRouter + AuthProvider + ThemeProvider
  App.tsx                  Route table; every app screen is lazy()-loaded
  index.css                Theme tokens + global CSS (READ THE COMMENTS)
  pages/                   Hub-level screens: Hub (launcher), Login, Admin
  apps/<id>/               One folder per family app:
    budget/                Budgets → Months → MonthDetail (+ EntryForm,
                           SummaryChart) — note: a "month" = one budget period
    shopping/              ShoppingList (Realtime-synced)
    pets/                  PetCare (events + next-due reminders)
    docs/                  DocumentVault (storage uploads, signed URLs)
  components/              Shared: BeachBackdrop, Drawer, AnalyticsTracker
  hooks/                   useAuth (profile + household members), useBack,
                           useTheme
  lib/                     apps.ts (hub registry), types.ts, format.ts,
                           categories.ts, analytics.ts, image.ts, supabase.ts
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

**Money/date helpers**: use `src/lib/format.ts` (`formatMoney`, `formatDay`,
`todayISO`, period helpers). Dates are ISO `YYYY-MM-DD` strings end-to-end;
compare them lexicographically, don't construct `Date` objects for that.

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
