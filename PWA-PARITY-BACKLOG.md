# PWA parity backlog

Things the **web PWA** (`src/`) is behind the **iOS app** (`mobile/`) on. iOS is
the priority, so features land there first; this list tracks what still needs to
be ported back to the web app "some other time."

The iOS implementation is the source of truth for each item — port its behavior,
adapting RN patterns to the web (Tailwind + the PWA's existing components).

---

## 1. Budget home card redesign v2 (2026-07-03)

The iOS Money home (`mobile/src/apps/budget/Budgets.tsx`) has a revised budget
card that the PWA (`src/apps/budget/Budgets.tsx`) does NOT yet have. The PWA
still shows the first iteration (hero-sized balance, and a period pill that just
navigates to the period list).

Port the iOS v2 layout to the PWA card:

- **Budget name is the card identity** — top-left, its own row, with a details
  **chevron on the top-right that opens the periods list** (`/budget/:id`, the
  Months screen — where you add a new period). The whole title row is tappable.
- **A divider** separates the name row from the overview section below.
- **Balance is not the hero** — under a small **"Current balance"** label
  (`t('chart.currentBalance')`, NOT "Balance today · N days left"), at ~22px
  instead of the 30px display size.
- **Period is an in-card dropdown** (not a link): a pill on the right of the
  overview header that drops down the budget's periods with a check on the
  selected one. Picking a period re-previews that period's balance + bars and
  points the "New entry" button at it. (iOS anchors the menu under the pill via
  measure-in-window; on web a simple absolutely-positioned dropdown works.)
- Then the **"With upcoming entries: $X"** line (only when future entries
  exist), the **received/spent bars**, and the **"＋ New entry"** button.
- The card now previews a *selectable* period, so the home query must load all
  months + entries and compute per-month stats (see the iOS `statsById` /
  `byBudget` memo).

Already at parity (no work needed): the amount-first **entry form**, **custom
categories** (migration 042), and the new i18n keys — all shipped to the PWA
already.

Files: `src/apps/budget/Budgets.tsx` (+ maybe a small dropdown helper).

## 2. Home "Today" section + home nudges (2026-07-03)

The iOS Hub gained a home dashboard the PWA doesn't have yet:

- **Sent nudges on the home banner** — the PWA's `PingsBanner` shows received
  nudges only; iOS `NudgesBanner` also lists nudges I *sent* with ack status
  ("seen by …") and a ✕ to dismiss (persisted per-device). Port to
  `src/components/PingsBanner.tsx` (dismiss via `localStorage`).
- **"Today" section** (`mobile/src/components/TodaySection.tsx`) between the
  greeting and the app grid: date + current weather (home city set in Settings,
  Open-Meteo, no geolocation permission — see `mobile/src/lib/weather.ts`), plus
  today's calendar events (birthdays/anniversaries highlighted) and pet-care
  due/overdue items. A "Weather / home city" control was added to iOS Settings.
  Port needs a web weather fetch + a home-city setting (localStorage or
  user_settings) and reuse of the PWA's calendar/petCare helpers.
