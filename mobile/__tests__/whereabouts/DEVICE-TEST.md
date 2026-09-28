# Whereabouts — Android device test (the part Jest can't prove)

Jest (`npm test`) proves the JS contracts in SPEC.md. This proves the phone.
Two phones: **A** = the Android under test (Galaxy S9+), **B** = the watcher
(any phone in the same household). Each step says what to look for on B and
how to confirm from the database, so nothing depends on eyeballing a map.

Database check (Supabase SQL editor, or ask Claude to run it):

```sql
select updated_at, accuracy, battery from member_locations
where user_email = '<A's email>';
```

## 0. Setup (once, on A, after installing the new build)

1. Open One Roof → Whereabouts → your card → Settings: sharing **on**. Accept
   the disclosure; location **"Allow all the time"**.
2. Android Settings → Apps → One Roof → Battery → **Unrestricted**
   (Samsung: also remove it from "Sleeping apps" / "Deep sleeping apps").
   Samsung kills background apps aggressively; everything below is meaningless
   until this is set. This is a one-time user step — worth a line in the
   Play listing / in-app help.
3. Notifications for One Roof allowed (Android 13+ asks; the S9+ doesn't).
4. Pull down the shade on A: a persistent **"Sharing your location"**
   notification must be there. No notification = no foreground service =
   Android throttles fixes to a few per hour. Stop here if it's missing.

## 1. Backgrounded (Home button)

A: press Home, walk/drive ≥ 500 m over ~5 min.
B: A's pin moves; "updated" stays within ~1–2 min.
DB: `updated_at` advances roughly every minute while moving.

## 2. Swiped away (the case that failed on 2026-09-26)

A: open Recents, swipe One Roof away. Move ≥ 500 m over ~10 min.
Expect: the "Sharing your location" notification is STILL in A's shade, and
B keeps seeing A move. DB `updated_at` keeps advancing.

## 3. Process killed by the OS (what Samsung does overnight)

Needs a USB cable + `adb`:

```bash
adb shell am kill one.roof.family.organizer
```

(`am kill` = what the low-memory killer does; NOT `force-stop`, which Android
treats as "the user wants this app dead" and blocks all restarts by design.)
Then move ≥ 500 m. Expect DB `updated_at` to keep advancing — slower until the
app is next opened (Android can't restart the foreground service from the
background), then back to ~1/min after opening the app once.

Before this fix, that first headless fix UNREGISTERED the task: `adb logcat`
showed `TaskManager: Execution of "oneroof-location-updates" was requested but
looks like it is not defined`, and updates stopped for good. Check that line
does NOT appear:

```bash
adb logcat | grep -i "TaskManager"
```

## 4. Live mode (the watcher opens A's card)

A: app in background (Home), screen off.
B: open Whereabouts, tap A's card. Expect A's pin to move within ~30 s and keep
moving while the card is open. Close the card on B: after ~1 min A steps back
to the saver cadence (battery).

## 5. Geofence

A: leave a saved place (Home) by ≥ 300 m with the app swiped away.
Expect a "left Home" row within a few minutes:

```sql
select type, at from place_events where user_email = '<A's email>'
order by at desc limit 5;
```

## 6. Reboot

Reboot A, unlock it, don't open the app, move. Android does NOT restart
location updates after a reboot until the app is opened (platform limit —
expo-location has no boot receiver). Open the app once → updates resume.
That's expected; note it in the listing's FAQ if users ask.

## For the Play Store video

Record step 0.1 (disclosure → "Allow all the time") and step 2 (swiped away,
B's map still moving) — that is exactly what the background-location
declaration review wants to see.
