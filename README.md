# One Roof 🏠

*Your family, under one roof.*

A multi-household PWA that bundles the little apps a family runs on: shared
budget, live grocery list, pet care log, and a private document vault. Built
for Arthur & Patricia, now multi-tenant so friend families get their own
private hub — same apps, completely separate data.

**Live:** https://one-roof-app.vercel.app (installable on iPhone via Safari →
Share → Add to Home Screen)

## The apps

| App | What it does |
| --- | --- |
| 💰 **Budget** | Shared-pot budgets with daily/weekly/monthly periods, per-person filters, charts, recurring entries, and AI receipt scanning (photo → parsed entry via Claude vision) |
| 🛒 **Shopping List** | One shared list, live-synced between phones (Supabase Realtime) |
| 🐕 **Pet Care** | Vet visits, vaccines, meds per pet — with "next due" reminders that retire automatically when you re-log a recurring treatment |
| 📄 **Documents** | Photos/PDFs of IDs, insurance cards, records in a private storage bucket, filterable by category and person |
| 🛠️ **Admin** | (Admins only) Create households, manage members, see last-access and app-usage analytics |

## Architecture in one paragraph

React SPA (Vite + TypeScript + Tailwind v4) on Vercel, with one serverless
function (`api/scan-receipt.ts`) for receipt OCR. All data lives in Supabase:
Postgres with row-level security doing the real access control, Google OAuth
for sign-in, Storage for documents, Realtime for the shopping list.
Multi-tenancy is enforced in the database — every table is scoped to a
`household_id` and RLS policies guarantee a family can only ever see its own
rows, no matter what the client sends. The hub is a launcher grid; each app is
a lazy-loaded folder under `src/apps/`.

**Working on this repo? Read [`CLAUDE.md`](CLAUDE.md)** — file map, patterns,
and the iOS/PWA pitfalls that cost us real debugging hours.

## Setup from scratch (~20 min)

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com) (free tier).
2. SQL Editor → run [`supabase/schema.sql`](supabase/schema.sql) **after
   editing the placeholder emails**, then run `migration-004` … `migration-009`
   in order (see the note at the bottom of schema.sql).
3. Make the first user an admin:
   `update allowed_users set is_admin = true where email = '<you>';`

### 2. Google sign-in

1. [Google Cloud Console](https://console.cloud.google.com) → new project.
2. [Auth Platform](https://console.cloud.google.com/auth/overview) → Get
   started → Audience **External** → add your emails as **Test users**.
3. Clients → Create client (**Web application**) with redirect URI
   `https://<project-ref>.supabase.co/auth/v1/callback`.
4. Paste Client ID + secret into Supabase → Authentication → Google.

### 3. Run locally

```sh
cp .env.example .env.local   # VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

### 4. Deploy

```sh
npx vercel deploy --prod --yes
```

There is **no git-push auto-deploy** — deploys are manual via the CLI. Set
`VITE_SUPABASE_*` (and `ANTHROPIC_API_KEY` for receipt scanning) in the Vercel
project env vars. Then in Supabase → Authentication → URL Configuration, set
the Site URL to the production domain and add it to the redirect allow-list.

## Adding a family

As an admin, open 🛠️ Admin in the app: create a household, add members by
display name + Google email. That's it — they sign in and get an empty hub of
their own. (Heads-up: receipt scanning bills the `ANTHROPIC_API_KEY` owner for
every household.)
