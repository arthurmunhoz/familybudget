# Raw Android captures go here

Shoot these on a real Android phone (power + volume-down), AirDrop/copy them
over, and name them `01-…png` … `08-…png`. The number picks the caption in
`make-screenshots.py`, and it is also the order Play displays them — so 01 is
the one most people will ever see.

| # | Screen to capture | Caption it gets |
|---|---|---|
| 01 | Whereabouts, map with pins + the roster along the bottom | See your family on a live map |
| 02 | The Hub | Everything for your home, in one app |
| 03 | Money, right after a receipt scan (the filled-in entry) | Snap a receipt, log the spending |
| 04 | Shopping list with a few items, one checked off | A shopping list that syncs as you shop |
| 05 | Whereabouts → Activity, an arrival showing | Know the moment they get home |
| 06 | Pet Care with a due/overdue reminder visible | Never miss a vet date again |
| 07 | Nudges, the preset list | One tap: "dinner's ready" |
| 08 | Documents | IDs and insurance, always with you |

Then:

```bash
python3 mobile/store/screenshots/make-screenshots.py
```

Output lands in `out/` at 1080×1920 — **upload those, not these**. Raw phone
captures are around 20:9, which is taller than the 9:16 Play allows, so they get
rejected on upload.

## First, build a fresh APK

There is no `expo-updates` in this project, so **nothing reaches a phone without
a build** — every JS change is compiled in. Any APK from before 2026-08-19 is
the wrong thing to photograph:

- **Google sign-in was broken on Android** until the `auth-callback` route
  landed, so you cannot sign in as the review account on an older build — and
  that account is what you should be shooting with.
- **The navigation bar covered docked buttons**, and the Add-pet sheet hid its
  own fields behind the keyboard. Those are precisely the surfaces in shots 02,
  06 and 08.
- **The Whereabouts map may be blank** if the build predates
  `EXPO_PUBLIC_MAPBOX_TOKEN` being added as an EAS env var (§4c) — which makes
  shot 01, the most important one, impossible.

```bash
cd mobile && eas build --platform android --profile preview
```

`preview` is `distribution: internal`, so it produces an installable APK rather
than an AAB, and it carries release chrome — no dev-menu artifacts and no
`__DEV__` email/password button on the login screen.

## Two things to get right before you shoot

**Use demo data, not your household.** These images are public forever. Sign in
with the review Google account (`one.roof.review@gmail.com`, see §3.3) and
populate it with invented members, a fake home address, and a pet — never your
own map position, phone numbers, documents or real spending. This is the most
common way an indie listing leaks something it can't take back.

**Stay in one theme.** Light mode matches the paper canvas the captions sit on.
Dark captures work too, but mixing the two across the eight looks accidental.
