-- Apple Calendar (EventKit) two-way sync.
--
-- Unlike Google, Apple/iCloud has NO server calendar API — the only sanctioned
-- access is on-device via EventKit (expo-calendar), so there are no OAuth tokens
-- and no connections table. Sync runs entirely on the iOS client; connection
-- state (granted? which device calendars? last sync? the oneroof->device id map)
-- lives per-device in AsyncStorage, not here.
--
-- The only schema needs: allow source='apple' and store the device event id so
-- re-imports upsert (instead of duplicating) and pruning can find removed rows.

alter table calendar_events drop constraint if exists calendar_events_source_check;
alter table calendar_events
  add constraint calendar_events_source_check
  check (source in ('oneroof', 'google', 'apple'));

alter table calendar_events add column if not exists apple_event_id text;

-- Dedup imported device events (EventKit ids are per-device UUIDs; mirrors the
-- google_event_id partial unique index).
create unique index if not exists calendar_events_apple_uidx
  on calendar_events (household_id, apple_event_id)
  where apple_event_id is not null;
