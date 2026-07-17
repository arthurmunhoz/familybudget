# One Roof — App Store Connect listing copy

Paste these into App Store Connect → your app → **App Information** / **Version**.
Character limits are Apple's; I've kept everything within them. Tweak to taste.

---

## Names & URLs

- **App Name** (30 char max): `One Roof: Family Organizer` — you've reserved this ✅ (26 chars)
- **Subtitle** (30 char max): `Calendar, shopping & budget` (27)
- **Bundle ID**: `com.oneroof.app`
- **SKU**: `oneroof` (private; any unique string)
- **Primary category**: Lifestyle · **Secondary**: Productivity
- **Age rating**: 4+ (no objectionable content, no tracking)
- **Support URL**: `https://one-roof-app.vercel.app/support.html`
- **Marketing URL**: `https://one-roof-app.vercel.app`
- **Privacy Policy URL**: `https://one-roof-app.vercel.app/privacy.html`
  *(all three go live after you deploy the PWA — `npx vercel deploy --prod`)*

## Promotional text (170 char max — editable anytime without review)

**v1.1 (current)** — 161/170. Deliberately explains what the app IS rather than
what's new: with no installed base yet, nobody is coming back to read a
changelog. Swap it for a widgets-led line once there are users to return.
`Welcome to One Roof! Your family's calendar, shopping, budget, pets, documents, and nudges — all in one shared app. Feedback: one.roof.family.organizer@gmail.com`

<sub>v1.0 was: `One home, one app. Shared calendar, shopping list, and budget — plus pet care, family documents, and quick nudges. Snap a receipt to log spending in seconds.`</sub>

## Keywords (100 char max, comma-separated, no spaces)
`shared,grocery,list,chores,household,planner,reminders,tasks,kids,couples,home,manager,checklist,pets,bills`

## Description

> Run your whole home from one app — not five.
>
> One Roof brings your family's calendar, shopping list, budget, pets, documents, and everyday coordination into a single shared space. Everyone in the household sees the same thing, in sync, instantly.
>
> • SHARED CALENDAR — everyone's plans in one place, color-coded by person, with birthdays, anniversaries, and renewal reminders.
> • SHOPPING LIST — add items and watch them sync live across the family; check things off from anywhere.
> • MONEY — track spending by budget and period. Snap a photo of a receipt and it fills in the amount, date, and category for you.
> • PET CARE — vet visits, medications, and vaccine due dates, with reminders so nothing slips.
> • DOCUMENTS — keep IDs, insurance, and records in a Face ID–locked vault.
> • FAMILY — everyone's key info at a glance.
> • NUDGES — one tap to say "on my way," "dinner's ready," or "grab milk" — and a call button for "need a hand."
>
> Built for real families:
> • One shared household — invite everyone, one simple bill (no per-person upcharge).
> • Private by design — your data is only visible to your household. No ads. No tracking.
> • Works in English, Spanish, and Portuguese.
>
> One roof. One app. Everything your household needs to run smoothly.

## What's New (v1.0)
`Welcome to One Roof! Your family's calendar, shopping, budget, pets, documents, and nudges — all in one shared app. We'd love your feedback: arthurmunhoz@hotmail.com`

## What's New (v1.1) — 4000 char max; paste into the new version's "What's New"

```
Home-Screen widgets are here.

• Today — your day at a glance: agenda, weather, and heads-up alerts. It keeps itself up to date even when you never open the app.
• Money — a budget's balance at a glance, plus add an entry or scan a receipt straight from the Home Screen.
• Nudges — send a one-tap nudge without opening the app, and see when someone's seen it.

Also in this release:

• Family, redesigned — swipe through everyone's photos and see their details on one card. Hold any detail to convert units (cm/ft, kg/lb, shoe sizes), or to check blood-type compatibility.
• Money — manage your categories at last: edit, rename, or delete them, including the built-in ones.
• Join a household with a code — new members can create or join a home the first time they sign in.
• Weather — find your home city with autocomplete, and get a heads-up when rain, storms, or extreme temperatures are on the way.
• The One Roof Plus page is now fully translated.
• Polish and fixes across Pet Care, Documents, and the Shopping List.
```

---

## Screenshots plan (6.7" iPhone required; add 6.5" + iPad if you keep tablet support)

Each screenshot = one screen with a bold caption bar on top. Lead with the differentiators.

1. **"Everything for your home, in one app"** — the Hub grid.
2. **"Snap a receipt → instant budget entry"** — Money receipt-scan result (the standout).
3. **"A shared list that syncs in real time"** — Shopping list.
4. **"Never miss a vet date"** — Pet Care with a due reminder.
5. **"One tap: 'dinner's ready' to the whole house"** — Nudges.
6. **"Face ID–locked family documents"** — Document Vault.

Tips: put a short benefit caption on each (not raw UI); localize the captions for ES + PT storefronts (in-app is already translated); a 15–30s App Preview video leading with the receipt scan helps a lot. I can help produce the caption art once you send device screenshots.

## Review notes (App Review → "Notes" field)
- Provide a **demo account** (the seeded test login) so review can sign in without Apple/Google.
- Note: receipt/bill images are sent to Anthropic (Claude) for data extraction; disclosed in the privacy policy and App Privacy details.
- Account deletion is in-app: Settings → Delete account.
