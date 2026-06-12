# Our Budget 💙

A private budgeting app for Arthur & Patricia. Track monthly income and
spending from one shared pot — no bill splitting, just one household.

**Stack:** React + TypeScript (Vite) · Tailwind CSS · Supabase (Postgres +
Google auth) · Recharts · deployed on Vercel · installable as a PWA on iPhone.

## Features

- **Months** — manual "Start MM/YY" button creates the next month and
  auto-copies all recurring entries (rent, subscriptions…) into it. Months are
  listed latest-first with their running balance.
- **Month view** — total received vs. spent with charts, filterable by person
  (Both / Arthur / Patricia — everything reacts to the filter).
- **Entries** — label, USD amount, category with icons (auto-suggested from
  the label and learned from your corrections), date, who, recurring flag.
- **Lists** — sorted by date (default) or amount; split view shows each
  person's spending side by side.
- **Private** — Google sign-in + Postgres row-level security; only the two
  emails in `allowed_users` can read or write anything.

## Setup (one time, ~15 min)

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com) (free tier).
2. Open **SQL Editor**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql),
   **edit the two placeholder emails** in the `allowed_users` insert to the
   Google emails you and Patricia will sign in with, and run it.

### 2. Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com), create a new
   project (top-bar project picker → **New Project**).
2. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview)
   → **Get started**: app name, support email, Audience: **External**, finish.
3. In **Audience → Test users**, add both Google account emails (while the
   app stays in Testing mode, only test users can sign in — ideal here).
4. In **Clients** → **Create client**: type **Web application**, and under
   **Authorized redirect URIs** add
   `https://<your-project-ref>.supabase.co/auth/v1/callback`.
5. Copy the Client ID and Client secret into Supabase →
   **Authentication → Sign In / Up → Google** (enable + save).

### 3. Local run

```sh
cp .env.example .env.local   # fill in URL + anon key from Supabase → Settings → API
npm install
npm run dev
```

### 4. Deploy to Vercel

1. Push this folder to a GitHub repo and import it in Vercel (defaults are fine).
2. Add the two `VITE_SUPABASE_*` environment variables in Vercel project settings.
3. In Supabase → **Authentication → URL Configuration**: set the Site URL to
   your Vercel URL and add it to the redirect allow-list.

### 5. iPhone

Open the Vercel URL in Safari → Share → **Add to Home Screen**. It runs
full-screen like a native app.
