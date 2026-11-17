-- Migration 120 — what location permission the sharing phone actually has.
--
-- 2026-11-17: Patricia's iPhone kept `sharing = true` while its position sat
-- 20 h old "at Home" and no place crossing had been recorded since 2026-11-06.
-- The edge logs showed her phone reporting ONLY while the app was open (a
-- fresh GET+POST pair on each open, nothing in between) and no geofence or
-- leash wake at all — what iOS does when "Always" has been turned down to
-- "While Using" (iOS asks "keep allowing in the background?" every so often).
-- Nothing told anyone: the app never re-checked the permission once sharing
-- was on.
--
-- The phone now writes what it has on every foreground; watchers show "only
-- updates while the app is open" instead of a plain stale chip, and the phone
-- itself shows a banner to put it back. null = an older app that doesn't say.
alter table public.member_locations
  add column if not exists bg_permission text
    check (bg_permission in ('always', 'while_using', 'denied'));
