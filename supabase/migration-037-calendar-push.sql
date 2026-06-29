-- Migration 037: two-way Google Calendar sync (push direction support).
--  • calendar_events.updated_at — bumped by the client on every edit; the sync
--    function pushes a row to Google when updated_at > synced_at (or unpushed).
--    Server sync writes set synced_at WITHOUT touching updated_at, so there's no
--    push loop.
--  • google_calendar_connections.time_zone — the linked calendar's IANA zone,
--    captured during pull; used to push timed events with the right offset.
--  • calendar_deletions — a tombstone written when a locally-deleted event had
--    been synced, so the next push removes it from Google too.

alter table calendar_events
  add column if not exists updated_at timestamptz not null default now();

alter table google_calendar_connections
  add column if not exists time_zone text;

create table if not exists calendar_deletions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household() references households(id),
  -- The event's original creator; routes the Google deletion to their connection.
  user_email text,
  google_event_id text not null,
  google_calendar_id text,
  created_at timestamptz not null default now()
);

alter table calendar_deletions enable row level security;

drop policy if exists calendar_deletions_rw on calendar_deletions;
create policy calendar_deletions_rw on calendar_deletions
  for all using (household_id = public.current_household())
  with check (household_id = public.current_household());
