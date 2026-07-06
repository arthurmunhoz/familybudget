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

## 3. Free-plan limits UX (2026-07-04)

Migration 047 enforces free-plan limits server-side for BOTH apps (1 budget for
non-Plus via a `budgets` trigger; `ai_config.free_monthly_cap = 3`). The iOS app
gates these gracefully (New-budget → paywall; scan cap → paywall). The **PWA does
not** yet:
- `src/apps/budget/Budgets.tsx` — gate "New budget" when `!isPlus` and the
  household already has a budget (route to the paywall) and catch the
  `free_plan_budget_limit` insert error; otherwise a free user just gets a failed
  insert.
- Confirm the PWA receipt-scan flow surfaces the `monthly_cap` reason as a
  paywall prompt (parity with iOS MonthDetail).

## 4. Nudges: sent banner CTAs + Need-Help buttons (2026-07-04)

`mobile/src/apps/pings/NudgesBanner.tsx` — the home banner now (a) lists SENT
nudges with ack status + a dismiss ✕, and (b) shows BOTH Call and Got it on a
"Need Help" nudge (so a recipient can acknowledge without calling). PWA
`src/components/PingsBanner.tsx` shows received-only with Call-OR-Got-it. Port
both.

## 5. Family: single-screen expandable member cards (2026-07-04)

`mobile/src/apps/family/Family.tsx` + `MemberDetail.tsx` — the separate member
detail page is gone; the list is an accordion that expands a member's full card
in place (fields, phone call button, "Edit my info"). PWA `src/apps/family/`
still has a list → detail page; make it expand inline.

## 6. Pet Care: per-pet view redesign (2026-07-04)

`mobile/src/apps/pets/` — Pet Care reworked to a per-pet view: pet carousel
(with All) → selected pet's info card (edit + a per-pet calendar color) → a
month calendar of all pets' events with per-pet colored dots + the upcoming
list. Adds `pets.tag_color` (migration). Port to PWA `src/apps/pets/`.

## 7a. Gotcha: don't inline a sub-component in Better Deal (or similar forms) (2026-07-06)

Not a parity gap — a bug fixed on iOS that's worth guarding against here too.
`mobile/src/apps/calc/BetterDeal.tsx` defined its `OptionCard` (the per-option
price/amount card) as a function *inside* `BetterDeal`'s render body. Every
keystroke changed state → re-rendered `BetterDeal` → gave React a brand-new
`OptionCard` component type → remounted the `TextInput`s → dropped keyboard
focus mid-type (most noticeable right as the "Better deal" winner badge first
appeared, since that's when both `TextInput`s' surrounding JSX changed). Fixed
by hoisting `OptionCard` to a stable top-level component.

The PWA's `BetterDeal` (`src/apps/calc/Calculator.tsx`) does **not** have this
bug — its `card(...)` is a plain function returning JSX inline (called
directly, not rendered as `<Card/>`), so React never sees a new component
type. No fix needed here, but if `Calculator.tsx` is ever refactored to
extract `card` into a real `function OptionCard(...)` / `<OptionCard/>`
component, hoist it to module scope (outside `BetterDeal`) rather than
defining it inside — same trap.

## 7. Nudges: editable presets + general high-priority type (2026-07-04)

`mobile/src/apps/pings/PingComposer.tsx` + `NudgesBanner.tsx` + `PingsHistory.tsx`
+ `lib/pings.ts`. Presets are now an editable per-household table (`ping_presets`,
migration 050, seeded via `seed_ping_presets()`); the composer has an "Edit
presets" mode (add/edit/delete emoji + label + a high-priority toggle). A general
`pings.high_priority` flag (replaces the old `kind='help'` special-casing) drives
the red UI + Call CTA + always-to-everyone send + urgent push (`api/send-ping.ts`
now keys `urgent` off `high_priority`) + an in-app `Vibration` buzz on arrival.
Port to the PWA: `src/apps/pings/` composer + PingsBanner + `lib/pings.ts`, and
the PWA web-push already flows through the same `send-ping`.

## 8. Discount calculator redesign (2026-07-06)

`mobile/src/apps/calc/Discount.tsx` — the plain price/percent/result-rows layout
became a deal-forward design: the sale price is the hero (big Fraunces "You pay"
number) with the original price struck through beside it and a green
"Save $X · N%" badge; the discount is a large "N% OFF" readout with quick chips,
a Custom field, and − / + fine-tune. Port to the PWA's `calc/Calculator.tsx`
Discount section. (New i18n: calc.youPay / off / savePill.)
