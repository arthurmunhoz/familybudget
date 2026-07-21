-- 074: a place subscription must actually be able to fire.
--
-- place_watchers rows are per-user opt-ins (migration 070). Nothing stopped a
-- row with BOTH notify_arrivals = false AND notify_departures = false — the UI
-- read as "subscribed to this place" while the push fan-out in
-- api/send-ping.ts (?action=place-event) filters on the direction and so could
-- never match it. A silent subscription is the worst failure mode here: the
-- user believes they're covered and simply never hears anything.
--
-- The client keeps the toggles in lockstep (PlaceForm turns the whole
-- subscription off when the last direction is cleared, and stores no row at
-- all in that case); this is the backstop so no other path can persist one.
--
-- Safe to add as-is: no existing row violates it (checked before applying).
alter table public.place_watchers
  drop constraint if exists place_watchers_needs_a_direction;

alter table public.place_watchers
  add constraint place_watchers_needs_a_direction
  check (notify_arrivals or notify_departures);
